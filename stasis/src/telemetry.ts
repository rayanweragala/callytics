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
  await publish('callytics:call-timeline', payload);
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
  await publish('callytics:call-timeline', payload);
}

export async function publishSipStatus(endpoints: SipEndpointStatus[]): Promise<void> {
  console.log(`[telemetry] publishing sip status for ${endpoints.length} endpoints`);
  await publish('callytics:sip-status', {
    ts: Date.now(),
    endpoints,
  });
}
