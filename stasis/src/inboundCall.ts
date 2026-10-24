import type { CallSession } from './callSession';
import { createSession, markCallEnded } from './callSession';
import type { Flow } from './flowLoader';
import type { CallEvent, SipTrafficEvent } from './telemetry';
import { logEvent, stasisLogger } from './logger';

export interface InboundStasisEvent {
  args?: string[];
  channel?: {
    caller?: { number?: string };
    dnid?: string;
    dialplan?: { context?: string; exten?: string };
  };
}

export interface InboundChannel {
  id: string;
  answer: () => Promise<void>;
  hangup: () => Promise<void>;
}

export interface InboundCallDeps {
  ariApp: string;
  failedCalls: Set<string>;
  publishSipTraffic: (event: SipTrafficEvent) => Promise<void>;
  publishCallEvent: (event: CallEvent) => Promise<void>;
  resolveInboundRoute: (did: string) => Promise<{ did: string; flowId: number } | null>;
  loadFlowById: (flowId: number) => Promise<Flow | null>;
  loadFlow: () => Promise<Flow | null>;
  createInboundBridge: (client: unknown, channelId: string) => Promise<{ id: string }>;
  destroyInboundBridge: (client: unknown, bridgeId: string) => Promise<void>;
  addSession: (session: CallSession) => void;
  removeSession: (channelId: string) => void;
  runFlow: (
    channel: InboundChannel,
    session: CallSession,
    client: unknown,
  ) => Promise<{ status: 'completed' | 'failed' } | undefined>;
}

/**
 * Runs the flow for one inbound call. Everything this function keeps is local
 * to the call (its own session, channel and bridge), so concurrent calls cannot
 * influence each other.
 */
export async function runInboundCall(
  client: { applications: { subscribe: (params: { applicationName: string; eventSource: string }) => Promise<unknown> } },
  event: InboundStasisEvent,
  channel: InboundChannel,
  channelExten: string,
  deps: InboundCallDeps,
): Promise<void> {
  const {
    ariApp: ARI_APP,
    failedCalls,
    publishSipTraffic,
    publishCallEvent,
    resolveInboundRoute,
    loadFlowById,
    loadFlow,
    createInboundBridge,
    destroyInboundBridge,
    addSession,
    removeSession,
    runFlow,
  } = deps;

  const callerNumber = event.channel?.caller?.number || "unknown";
  const inboundDid = String(
    event.channel?.dnid || channelExten || "",
  ).trim();
  stasisLogger.log(`Incoming call: ${channel.id} from ${callerNumber}`);
  try {
    await publishSipTraffic({
      callId: channel.id,
      timestamp: new Date().toISOString(),
      method: "INVITE",
      from: callerNumber,
      to: inboundDid || channelExten,
      direction: "inbound",
      responseCode: null,
      rawMessage: `INVITE sip:${inboundDid || channelExten} SIP/2.0`,
    });
  } catch (err) {
    stasisLogger.error(
      "[telemetry] sip traffic publish failed (StasisStart):",
      err,
    );
  }

  let flow = null;
  if (inboundDid) {
    try {
      const route = await resolveInboundRoute(inboundDid);
      if (route) {
        stasisLogger.log(
          `[routing] inbound route found DID=${route.did} flow_id=${route.flowId}`,
        );
        flow = await loadFlowById(route.flowId);
      } else {
        stasisLogger.warn(
          `[routing] no inbound route for DID ${inboundDid}, using default flow`,
        );
      }
    } catch (error) {
      stasisLogger.error(
        `[routing] inbound route lookup failed DID=${inboundDid}:`,
        error,
      );
    }
  }

  if (!flow) {
    flow = await loadFlow();
  }
  if (!flow) {
    stasisLogger.warn("No published flow found. Hanging up.");
    try {
      await channel.hangup();
    } catch {}
    return;
  }

  logEvent("StasisStart", {
    channelId: channel.id,
    callerId: callerNumber,
    calledNumber: inboundDid || channelExten,
    flowId: flow.id,
  });

  const entryNode =
    flow.nodes.find((node) => node.type === "start") || flow.nodes[0];
  const session = createSession(
    channel.id,
    callerNumber,
    flow,
    entryNode.nodeKey,
  );
  addSession(session);

  try {
    await publishCallEvent({
      callId: channel.id,
      timestamp: new Date().toISOString(),
      type: "started",
      caller: callerNumber,
      destination: inboundDid || channelExten,
      flowId: flow.id,
      flowVersionId: flow.versionId,
      entryNodeKey: entryNode.nodeKey,
    });
  } catch (err) {
    stasisLogger.error(
      "[telemetry] call event publish failed (StasisStart):",
      err,
    );
  }

  try {
    await channel.answer();
    session.inboundBridge = await createInboundBridge(client, channel.id);
    try {
      await client.applications.subscribe({
        applicationName: ARI_APP,
        eventSource: `channel:${channel.id}`,
      });
      stasisLogger.log(
        `Subscribed ARI app ${ARI_APP} to channel:${channel.id}`,
      );
    } catch (error) {
      stasisLogger.error(
        `Failed to subscribe ARI app ${ARI_APP} to channel:${channel.id}:`,
        error,
      );
    }
    await runFlow(channel, session, client).then((res) => {
      if (res?.status === "failed") {
        failedCalls.add(channel.id);
      }
    });
  } catch (error) {
    stasisLogger.error("Error running flow:", error);
    const failureReason =
      error instanceof Error ? error.message : "Unknown flow error";
    failedCalls.add(channel.id);
    try {
      await publishCallEvent({
        callId: channel.id,
        timestamp: new Date().toISOString(),
        type: "failed",
        caller: session.callerNumber,
        destination: inboundDid || channelExten,
        flowId: session.flow.id,
        flowVersionId: session.flow.versionId,
        failedNode: "runtime",
        failureReason,
      });
    } catch (err) {
      stasisLogger.error(
        "[telemetry] call event publish failed (flow error):",
        err,
      );
    }
    if (session.inboundBridge) {
      await destroyInboundBridge(client, session.inboundBridge.id);
      session.inboundBridge = null;
    }
    try {
      await channel.hangup();
    } catch {}
    markCallEnded(session);
    removeSession(channel.id);
  }
}
