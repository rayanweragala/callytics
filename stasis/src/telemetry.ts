import { CallSession } from './callSession';
import { FlowNode } from './flowLoader';
import { publish } from './redis';

export interface NodeTelemetryEvent {
  callId: string;
  flowId: number;
  nodeId: string;
  nodeType: string;
  status: 'started' | 'completed' | 'error';
  ts: number;
  meta: Record<string, unknown>;
}

export interface SipEndpointStatus {
  endpoint: string;
  aor: string;
  contacts: string[];
  state: 'registered' | 'unregistered' | 'unknown';
  updatedAt: number;
}

export interface SipTrafficEvent {
  timestamp: string;
  method: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  responseCode: number | null;
  rawMessage: string;
}

export interface CallEvent {
  callId: string;
  timestamp: string;
  type: 'started' | 'failed' | 'ended';
  caller: string;
  flowId?: number;
  flowVersionId?: number;
  entryNodeKey?: string;
  exitNodeKey?: string;
  failedNode?: string;
  failureReason?: string;
  durationSeconds?: number;
}

export async function publishNodeTelemetry(
  session: CallSession,
  node: FlowNode,
  status: NodeTelemetryEvent['status'],
  meta: Record<string, unknown> = {},
): Promise<void> {
  const payload: NodeTelemetryEvent = {
    callId: session.channelId,
    flowId: session.flow.id,
    nodeId: node.nodeKey,
    nodeType: node.type,
    status,
    ts: Date.now(),
    meta,
  };

  console.log(`[telemetry] publishing node event ${payload.nodeType}:${payload.status} for ${payload.callId}`);
  try {
    await publish('callytics:call-timeline', payload);
  } catch (err) {
    console.error('[telemetry] failed to publish node event', err);
  }
}

export async function publishCallEndTelemetry(
  callId: string,
  flowId: number,
  callerNumber: string,
): Promise<void> {
  const payload: NodeTelemetryEvent = {
    callId,
    flowId,
    nodeId: 'hangup',
    nodeType: 'hangup',
    status: 'completed',
    ts: Date.now(),
    meta: {
      result: 'hangup',
      eventType: 'StasisEnd',
      callerNumber,
    },
  };

  console.log(`[telemetry] publishing node event ${payload.nodeType}:${payload.status} for ${payload.callId}`);
  try {
    await publish('callytics:call-timeline', payload);
  } catch (err) {
    console.error('[telemetry] failed to publish call end event', err);
  }
}

export async function publishSipStatus(endpoints: SipEndpointStatus[]): Promise<void> {
  console.log(`[telemetry] publishing sip status for ${endpoints.length} endpoints`);
  try {
    await publish('callytics:sip-status', {
      ts: Date.now(),
      endpoints,
    });
  } catch (err) {
    console.error('[telemetry] failed to publish sip status', err);
  }
}

export async function publishSipTraffic(event: SipTrafficEvent): Promise<void> {
  console.log(`[telemetry] publishing sip traffic ${event.method} ${event.direction}`);
  try {
    await publish('callytics:sip-traffic', event);
  } catch (err) {
    console.error('[telemetry] failed to publish sip traffic', err);
  }
}

export async function publishCallEvent(event: CallEvent): Promise<void> {
  console.log(`[telemetry] publishing call event ${event.type} for ${event.callId}`);
  try {
    await publish('callytics:call-events', event);
  } catch (err) {
    console.error('[telemetry] failed to publish call event', err);
  }
}
