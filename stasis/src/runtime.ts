import { CallSession } from './callSession';
import { query } from './db';
import { Flow, loadFlowById } from './flowLoader';
import { executeNode } from './nodes';
import { resolveNextEdge } from './engine/edgeResolver';

interface FlowStackFrame {
  flow: Flow;
  menuNodeKey: string;
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

async function returnToParentFlow(session: CallSession, stack: FlowStackFrame[]): Promise<boolean> {
  const frame = stack.pop();
  if (!frame) {
    return false;
  }

  session.flow = frame.flow;
  const completeEdge = resolveNextEdge(frame.menuNodeKey, 'menu', 'complete', frame.flow.edges);
  if (!completeEdge) {
    console.warn(`No on_complete edge found for menu ${frame.menuNodeKey}`);
    return false;
  }

  session.currentNodeKey = completeEdge.targetNodeKey;
  return true;
}

export async function runFlow(
  channel: { id: string },
  session: CallSession,
  ariClient: unknown
): Promise<void> {
  const initialNodeKey = findEntryNode(session.flow);

  if (!initialNodeKey) {
    console.error('No entry node found in flow');
    return;
  }

  session.currentNodeKey = initialNodeKey;
  const stack: FlowStackFrame[] = [];

  while (true) {
    const node = session.flow.nodes.find((item) => item.nodeKey === session.currentNodeKey);

    if (!node) {
      console.warn(`Node not found: ${session.currentNodeKey}`);
      if (await returnToParentFlow(session, stack)) {
        continue;
      }
      break;
    }

    console.log(`Executing node: ${node.type} (${node.nodeKey})`);

    const result = await executeNode(channel as never, node, session, ariClient);

    console.log(`Node result: ${result}`);

    if (result === 'done' || result === 'hangup') {
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
      break;
    }

    if (result.startsWith('route:')) {
      session.currentNodeKey = result.slice('route:'.length);
      continue;
    }

    const edge = resolveNextEdge(session.currentNodeKey, node.type, result, session.flow.edges);

    if (!edge) {
      if (node.type === 'menu') {
        const submenuTargetNodeKey = getMenuSubflowTargetNodeKey(node.config, result);
        if (submenuTargetNodeKey) {
          const subflowId = await getMenuSubflowId(session.flow.versionId, node.nodeKey);
          if (!subflowId) {
            console.error(`Menu ${node.nodeKey} has submenu mapping for "${result}" but no subflow id`);
            break;
          }

          const subflow = await loadFlowById(subflowId);
          if (!subflow) {
            console.error(`Subflow ${subflowId} could not be loaded for menu ${node.nodeKey}`);
            break;
          }

          const targetNode = subflow.nodes.find((item) => item.nodeKey === submenuTargetNodeKey);
          if (!targetNode) {
            console.error(`Subflow ${subflowId} missing mapped target node ${submenuTargetNodeKey} for menu ${node.nodeKey} result ${result}`);
            break;
          }

          stack.push({ flow: session.flow, menuNodeKey: node.nodeKey });
          session.flow = subflow;
          session.currentNodeKey = targetNode.nodeKey;
          continue;
        }
      }

      console.error(`No edge found from ${session.currentNodeKey} with result ${result}`);
      if (node.type === 'play_audio') {
        console.warn(`Dead-end play_audio node ${node.nodeKey}; hanging up call ${session.channelId}`);
        try {
          await (channel as { hangup?: () => Promise<void> }).hangup?.();
        } catch {}
        break;
      }
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
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
      console.error(`Target node ${edge.targetNodeKey} not found in flow ${session.flow.id} and no subflow available from ${node.nodeKey}`);
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
      break;
    }

    const subflow = await loadFlowById(subflowId);
    if (!subflow) {
      console.error(`Subflow ${subflowId} could not be loaded for menu ${node.nodeKey}`);
      if (stack.length > 0 && await returnToParentFlow(session, stack)) {
        continue;
      }
      break;
    }

    stack.push({ flow: session.flow, menuNodeKey: node.nodeKey });
    session.flow = subflow;
    session.currentNodeKey = subflow.nodes.find((item) => item.nodeKey === edge.targetNodeKey)?.nodeKey
      || findEntryNode(subflow)
      || edge.targetNodeKey;
  }

  console.log(`Call ended: ${session.channelId}`);
}
