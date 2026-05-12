import { CallSession, markCallEnded } from './callSession';
import { query } from './db';
import { Flow, loadFlowById } from './flowLoader';
import { executeNode } from './nodes';
import { resolveNextEdge } from './engine/edgeResolver';
import { publishCallEvent } from './telemetry';
import { fireWebhookAsync } from './executors/webhook.executor';
import { logEvent } from './logger';

interface FlowStackFrame {
  flow: Flow;
  menuNodeKey: string;
}

async function insertNodeLog(session: CallSession, node: { nodeKey: string; type: string }): Promise<void> {
  try {
    // TODO(arch): Violation: Stasis writes call_node_logs directly to PostgreSQL instead of Redis->NestJS persistence.
    // Kept here because entered_at must be recorded in lockstep with node execution; Redis ordering guarantees are not in place yet.
    // Correct fix: publish enter event on callytics:call-node-log and persist in a NestJS listener.
    // Deferred post-launch as tracked technical debt.
    await query(
      `
        INSERT INTO call_node_logs (call_uuid, flow_id, node_key, node_type, entered_at)
        VALUES ($1, $2, $3, $4, NOW())
      `,
      [session.callUuid, session.flow.id, node.nodeKey, node.type],
    );
  } catch (error) {
    logEvent('CallNodeLogInsertFailed', { callId: session.callUuid, nodeId: node.nodeKey, error });
  }
}

async function updateNodeLog(
  session: CallSession,
  node: { nodeKey: string },
  branch: string | null,
  errorMessage: string | null,
): Promise<void> {
  try {
    // TODO(arch): Violation: Stasis writes call_node_logs directly to PostgreSQL instead of Redis->NestJS persistence.
    // Kept here because exited_at/branch/error must be recorded in lockstep with node completion; Redis ordering guarantees are not in place yet.
    // Correct fix: publish exit event on callytics:call-node-log and persist in a NestJS listener.
    // Deferred post-launch as tracked technical debt.
    await query(
      `
        UPDATE call_node_logs
        SET exited_at = NOW(),
            exit_branch = $4,
            error_message = $5
        WHERE id = (
          SELECT id
          FROM call_node_logs
          WHERE call_uuid = $1
            AND flow_id = $2
            AND node_key = $3
            AND exited_at IS NULL
          ORDER BY entered_at DESC, id DESC
          LIMIT 1
        )
      `,
      [session.callUuid, session.flow.id, node.nodeKey, branch, errorMessage],
    );
  } catch (error) {
    logEvent('CallNodeLogUpdateFailed', { callId: session.callUuid, nodeId: node.nodeKey, error });
  }
}

function consumeNodeError(session: CallSession): string | null {
  const message = String(session.variables.__last_node_error__ || '').trim();
  if (!message) {
    return null;
  }
  delete session.variables.__last_node_error__;
  return message;
}

function findEntryNode(flow: Flow): string | null {
  return flow.nodes.find((node) => node.type === 'start')?.nodeKey || flow.nodes[0]?.nodeKey || null;
}

function getMenuSubflowTargetNodeKey(config: Record<string, unknown> | undefined, result: string): string | null {
  if (!config) {
    return null;
  }

  const rawTargets = config.submenu_branch_targets;
  if (!rawTargets || typeof rawTargets !== 'object' || Array.isArray(rawTargets)) {
    return null;
  }

  const mapping = rawTargets as Record<string, unknown>;
  const targetNodeKey = String(mapping[result] || '').trim();
  return targetNodeKey || null;
}

function getMenuBranchSubflowId(config: Record<string, unknown> | undefined, result: string): number | null {
  if (!config) {
    return null;
  }

  const rawFlows = config.submenu_branch_flows;
  if (!rawFlows || typeof rawFlows !== 'object' || Array.isArray(rawFlows)) {
    return null;
  }

  const branchEntry = (rawFlows as Record<string, unknown>)[result];
  if (!branchEntry || typeof branchEntry !== 'object' || Array.isArray(branchEntry)) {
    return null;
  }

  const flowIdRaw = (branchEntry as Record<string, unknown>).flowId;
  const flowId = Number(flowIdRaw || 0);
  return Number.isFinite(flowId) && flowId > 0 ? flowId : null;
}

async function getMenuSubflowId(versionId: number, nodeKey: string): Promise<number | null> {
  const rows = await query(
    `
      SELECT subflow_id
      FROM flow_nodes
      WHERE flow_version_id = $1 AND node_key = $2
      LIMIT 1
    `,
    [versionId, nodeKey],
  );

  const subflowId = rows[0]?.subflow_id;
  const parsed = Number(subflowId || 0);
  return parsed > 0 ? parsed : null;
}

async function getMenuBranchSubflowIdFromParentLink(
  flowId: number,
  nodeKey: string,
  branchKey: string,
): Promise<number | null> {
  const rows = await query(
    `
      SELECT id
      FROM call_flows
      WHERE parent_flow_id = $1
        AND parent_node_key = $2
        AND parent_branch_key = $3
        AND status = 'published'
      ORDER BY id ASC
      LIMIT 1
    `,
    [flowId, nodeKey, branchKey],
  );

  const subflowId = Number(rows[0]?.id || 0);
  return Number.isFinite(subflowId) && subflowId > 0 ? subflowId : null;
}

async function returnToParentFlow(session: CallSession, stack: FlowStackFrame[]): Promise<boolean> {
  const frame = stack.pop();
  if (!frame) {
    return false;
  }

  session.flow = frame.flow;
  const completeEdge = resolveNextEdge(frame.menuNodeKey, 'menu', 'complete', frame.flow.edges);
  if (!completeEdge) {
    logEvent('FlowRoutingMissingCompleteEdge', { menuNodeKey: frame.menuNodeKey });
    return false;
  }

  session.currentNodeKey = completeEdge.targetNodeKey;
  return true;
}

function fireWebhookSideEffects(
  sourceNodeKey: string,
  flow: Flow,
  session: CallSession,
): void {
  const nodeByKey = new Map(flow.nodes.map((node) => [node.nodeKey, node]));
  const sourceNode = nodeByKey.get(sourceNodeKey);
  const outgoing = flow.edges.filter((edge) => edge.sourceNodeKey === sourceNodeKey);
  for (const edge of outgoing) {
    const targetNode = nodeByKey.get(edge.targetNodeKey);
    if (targetNode?.type === 'webhook' && sourceNode) {
      fireWebhookAsync(targetNode, session, sourceNode);
    }
  }
}

function getRoutingEdgesExcludingWebhookTargets(
  sourceNodeKey: string,
  flow: Flow,
): Flow['edges'] {
  const nodeByKey = new Map(flow.nodes.map((node) => [node.nodeKey, node]));
  return flow.edges.filter((edge) => {
    if (edge.sourceNodeKey !== sourceNodeKey) {
      return false;
    }
    const targetNode = nodeByKey.get(edge.targetNodeKey);
    return targetNode?.type !== 'webhook';
  });
}

function resolveWebhookEdge(
  sourceNodeKey: string,
  nodeType: string,
  result: string,
  flow: Flow,
): Flow['edges'][number] | null {
  const nodeByKey = new Map(flow.nodes.map((node) => [node.nodeKey, node]));
  const webhookEdges = flow.edges.filter((edge) => (
    edge.sourceNodeKey === sourceNodeKey
    && nodeByKey.get(edge.targetNodeKey)?.type === 'webhook'
  ));

  return resolveNextEdge(sourceNodeKey, nodeType, result, webhookEdges);
}

function getWebhookTargetNode(
  edge: Flow['edges'][number] | null,
  flow: Flow,
) {
  if (!edge) {
    return null;
  }
  const targetNode = flow.nodes.find((node) => node.nodeKey === edge.targetNodeKey);
  if (targetNode?.type !== 'webhook') {
    return null;
  }

  return targetNode;
}

function isPostCompletionRoutableNode(type: string): boolean {
  return type === 'voicemail' || type === 'callback' || type === 'transfer' || type === 'hunt';
}

function getEventChannelId(
  event: { channel?: { id?: string } } | undefined,
  channel: { id?: string } | undefined,
): string {
  return String(channel?.id || event?.channel?.id || '');
}

async function hangupAndWaitForSessionEnd(
  channel: { id: string; hangup?: () => Promise<void> },
  session: CallSession,
  ariClient: unknown,
): Promise<void> {
  const supportsStasisEvents = (
    typeof ariClient === 'object'
    && ariClient !== null
    && typeof (ariClient as { on?: unknown }).on === 'function'
    && typeof (ariClient as { removeListener?: unknown }).removeListener === 'function'
  );

  let cleanup = () => {};
  let waitForEnd: Promise<void> | null = null;

  if (!session.call_ended_at && supportsStasisEvents) {
    waitForEnd = new Promise<void>((resolve) => {
      const eventClient = ariClient as {
        on: (
          event: string,
          listener: (
            event: { channel?: { id?: string } },
            channel?: { id?: string },
          ) => void,
        ) => void;
        removeListener: (
          event: string,
          listener: (
            event: { channel?: { id?: string } },
            channel?: { id?: string },
          ) => void,
        ) => void;
      };

      const onStasisEnd = (
        event: { channel?: { id?: string } },
        endedChannel?: { id?: string },
      ) => {
        if (getEventChannelId(event, endedChannel) !== session.channelId) {
          return;
        }
        markCallEnded(session);
        cleanup();
        resolve();
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, 1000);

      cleanup = () => {
        clearTimeout(timeout);
        eventClient.removeListener('StasisEnd', onStasisEnd);
      };

      eventClient.on('StasisEnd', onStasisEnd);
    });
  }

  try {
    await channel.hangup?.();
  } catch {
    // channel may have already ended — safe to ignore.
  }

  if (session.call_ended_at) {
    cleanup();
    return;
  }

  if (waitForEnd) {
    await waitForEnd;
  }
}

export async function runFlow(
  channel: { id: string },
  session: CallSession,
  ariClient: unknown
): Promise<{ status: 'completed' | 'failed' }> {
  const initialNodeKey = findEntryNode(session.flow);

  if (!initialNodeKey) {
    logEvent('FlowMissingEntryNode', { flowId: session.flow.id, channelId: session.channelId });
    await publishCallEvent({
      callId: session.channelId,
      timestamp: new Date().toISOString(),
      type: 'failed',
      caller: session.callerNumber,
      flowId: session.flow.id,
      failureReason: 'No entry node found in flow',
    });
    return { status: 'failed' };
  }

  session.currentNodeKey = initialNodeKey;
  const stack: FlowStackFrame[] = [];
  let lastNodeKey = initialNodeKey;
  let finalStatus: 'completed' | 'failed' = 'completed';
  let failureReason: string | null = null;

  while (true) {
    const node = session.flow.nodes.find((item) => item.nodeKey === session.currentNodeKey);
    lastNodeKey = session.currentNodeKey;

    if (!node) {
      logEvent('FlowNodeNotFound', { nodeId: session.currentNodeKey, flowId: session.flow.id, channelId: session.channelId });
      if (await returnToParentFlow(session, stack)) {
        continue;
      }
      finalStatus = 'failed';
      failureReason = `Node not found: ${session.currentNodeKey}`;
      break;
    }

    // TODO(arch): Violation: synchronous node-log write is direct PostgreSQL from Stasis, not Redis->NestJS.
    // Needed today to keep entered_at ordering exact with node execution because Redis ordering is not guaranteed yet.
    // Correct fix: emit enter event on callytics:call-node-log and let NestJS persist.
    // Deferred post-launch as tracked technical debt.
    await insertNodeLog(session, node);

    let result = 'hangup';
    let runtimeError: string | null = null;
    try {
      result = await executeNode(channel as never, node, session, ariClient);
      runtimeError = consumeNodeError(session);
    } catch (error) {
      runtimeError = error instanceof Error ? error.message : 'unknown error';
      result = 'hangup';
      finalStatus = 'failed';
      failureReason = runtimeError;
    }

    // TODO(arch): Violation: synchronous node-log update is direct PostgreSQL from Stasis, not Redis->NestJS.
    // Needed today to keep exited_at/exit metadata ordered with node completion because Redis ordering is not guaranteed yet.
    // Correct fix: emit exit event on callytics:call-node-log and let NestJS persist.
    // Deferred post-launch as tracked technical debt.
    await updateNodeLog(session, node, result, runtimeError);

    logEvent('NodeResult', { nodeType: node.type, nodeId: node.nodeKey, channelId: session.channelId, callerId: session.callerNumber, result });

    if (result === 'done' && isPostCompletionRoutableNode(node.type)) {
      const completedNodeKey = node.nodeKey;
      const webhookEdge = resolveWebhookEdge(completedNodeKey, node.type, result, session.flow);
      const webhookNode = getWebhookTargetNode(webhookEdge, session.flow);
      const routingEdges = getRoutingEdgesExcludingWebhookTargets(completedNodeKey, session.flow);
      const edge = resolveNextEdge(completedNodeKey, node.type, result, routingEdges);

      if (edge) {
        const nextNode = session.flow.nodes.find((item) => item.nodeKey === edge.targetNodeKey);
        if (nextNode) {
          session.currentNodeKey = nextNode.nodeKey;
          continue;
        }

        logEvent('FlowTargetNodeNotFound', { targetNodeId: edge.targetNodeKey, flowId: session.flow.id, sourceNodeId: completedNodeKey });
        finalStatus = 'failed';
        failureReason = `Target node ${edge.targetNodeKey} not found`;
        break;
      }

      if (webhookNode) {
        await hangupAndWaitForSessionEnd(channel, session, ariClient);
        fireWebhookAsync(webhookNode, session, node);
        break;
      }
    }

    if (result === 'done' || result === 'hangup') {
      try {
        await (channel as { hangup?: () => Promise<void> }).hangup?.();
      } catch {
        // channel may have already ended — safe to ignore.
      }
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
      break;
    }

    if (result.startsWith('route:')) {
      session.currentNodeKey = result.slice('route:'.length);
      continue;
    }

    fireWebhookSideEffects(session.currentNodeKey, session.flow, session);
    const routingEdges = getRoutingEdgesExcludingWebhookTargets(session.currentNodeKey, session.flow);
    const edge = resolveNextEdge(session.currentNodeKey, node.type, result, routingEdges);

    if (!edge) {
      if (node.type === 'menu') {
        const branchSubflowId =
          getMenuBranchSubflowId(node.config, result)
          || await getMenuBranchSubflowIdFromParentLink(session.flow.id, node.nodeKey, result);
        if (branchSubflowId) {
          const subflow = await loadFlowById(branchSubflowId);
          if (!subflow) {
            logEvent('SubflowLoadFailed', { subflowId: branchSubflowId, nodeId: node.nodeKey });
            finalStatus = 'failed';
            failureReason = `Subflow ${branchSubflowId} load failure`;
            break;
          }

          const subflowEntryNodeKey = findEntryNode(subflow);
          if (!subflowEntryNodeKey) {
            logEvent('SubflowMissingEntryNode', { subflowId: branchSubflowId, nodeId: node.nodeKey, result });
            finalStatus = 'failed';
            failureReason = `Subflow ${branchSubflowId} missing entry node`;
            break;
          }

          stack.push({ flow: session.flow, menuNodeKey: node.nodeKey });
          session.flow = subflow;
          session.currentNodeKey = subflowEntryNodeKey;
          continue;
        }

        const submenuTargetNodeKey = getMenuSubflowTargetNodeKey(node.config, result);
        if (submenuTargetNodeKey) {
          const subflowId = await getMenuSubflowId(session.flow.versionId, node.nodeKey);
          if (!subflowId) {
            logEvent('SubflowMissingId', { nodeId: node.nodeKey, result });
            finalStatus = 'failed';
            failureReason = `Menu ${node.nodeKey} submenu missing subflow_id`;
            break;
          }

          const subflow = await loadFlowById(subflowId);
          if (!subflow) {
            logEvent('SubflowLoadFailed', { subflowId, nodeId: node.nodeKey });
            finalStatus = 'failed';
            failureReason = `Subflow ${subflowId} load failure`;
            break;
          }

          const targetNode = subflow.nodes.find((item) => item.nodeKey === submenuTargetNodeKey);
          if (!targetNode) {
            logEvent('SubflowTargetMissing', { subflowId, nodeId: node.nodeKey, targetNodeId: submenuTargetNodeKey, result });
            finalStatus = 'failed';
            failureReason = `Subflow ${subflowId} missing target node ${submenuTargetNodeKey}`;
            break;
          }

          stack.push({ flow: session.flow, menuNodeKey: node.nodeKey });
          session.flow = subflow;
          session.currentNodeKey = targetNode.nodeKey;
          continue;
        }
      }

      if (node.type === 'queue_login' && result === 'authenticated') {
        logEvent('QueueLoginTerminalAuthenticated', { nodeId: node.nodeKey, channelId: session.channelId });
        break;
      }
      logEvent('FlowEdgeNotFound', { nodeId: session.currentNodeKey, result, channelId: session.channelId });
      if (node.type === 'play_audio') {
        logEvent('DeadEndPlayAudio', { nodeId: node.nodeKey, channelId: session.channelId });
        try {
          await (channel as { hangup?: () => Promise<void> }).hangup?.();
        } catch {
          // channel may have already ended — safe to ignore.
        }
        break;
      }
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }

      finalStatus = 'failed';
      failureReason = `No edge found from ${node.nodeKey} (${node.type}) for result "${result}"`;
      break;
    }

    const nextNode = session.flow.nodes.find((item) => item.nodeKey === edge.targetNodeKey);
    if (nextNode) {
      session.currentNodeKey = nextNode.nodeKey;
      continue;
    }

    const subflowId = node.type === 'menu'
      ? await getMenuSubflowId(session.flow.versionId, node.nodeKey)
      : null;

    if (!subflowId) {
      logEvent('FlowTargetNodeNotFound', { targetNodeId: edge.targetNodeKey, flowId: session.flow.id, sourceNodeId: node.nodeKey });
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
      finalStatus = 'failed';
      failureReason = `Target node ${edge.targetNodeKey} not found`;
      break;
    }

    const subflow = await loadFlowById(subflowId);
    if (!subflow) {
      logEvent('SubflowLoadFailed', { subflowId, nodeId: node.nodeKey });
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
      finalStatus = 'failed';
      failureReason = `Subflow ${subflowId} load failure`;
      break;
    }

    stack.push({ flow: session.flow, menuNodeKey: node.nodeKey });
    session.flow = subflow;
    session.currentNodeKey = subflow.nodes.find((item) => item.nodeKey === edge.targetNodeKey)?.nodeKey
      || findEntryNode(subflow)
      || edge.targetNodeKey;
  }

  if (finalStatus === 'failed') {
    await publishCallEvent({
      callId: session.channelId,
      timestamp: new Date().toISOString(),
      type: 'failed',
      caller: session.callerNumber,
      flowId: session.flow.id,
      failedNode: lastNodeKey,
      failureReason: failureReason || 'Flow execution failed',
    });
  } else {
    await publishCallEvent({
      callId: session.channelId,
      timestamp: new Date().toISOString(),
      type: 'ended',
      caller: session.callerNumber,
      flowId: session.flow.id,
      durationSeconds: Math.round((Date.now() - session.startedAt.getTime()) / 1000),
    });
  }

  logEvent('CallFlowEnded', { channelId: session.channelId, callerId: session.callerNumber, status: finalStatus });
  return { status: finalStatus };
}
