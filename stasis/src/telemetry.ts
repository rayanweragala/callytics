import { CallSession } from './callSession';
import { FlowNode } from './flowLoader';
import { logEvent } from './logger';
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
  callId: string | null;
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
  direction?: 'inbound' | 'outbound';
  destination?: string;
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

  logEvent('TelemetryPublish', { channel: 'callytics:call-timeline', nodeType: payload.nodeType, status: payload.status, callId: payload.callId });
  try {
    await publish('callytics:call-timeline', payload);
  } catch (err) {
    logEvent('TelemetryPublishFailed', { channel: 'callytics:call-timeline', error: err });
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

  logEvent('TelemetryPublish', { channel: 'callytics:call-timeline', nodeType: payload.nodeType, status: payload.status, callId: payload.callId });
  try {
    await publish('callytics:call-timeline', payload);
  } catch (err) {
    logEvent('TelemetryPublishFailed', { channel: 'callytics:call-timeline', error: err });
  }
}

export async function publishSipStatus(endpoints: SipEndpointStatus[]): Promise<void> {
  logEvent('TelemetryPublish', { channel: 'callytics:sip-status', endpointCount: endpoints.length });
  try {
    await publish('callytics:sip-status', {
      ts: Date.now(),
      endpoints,
    });
  } catch (err) {
    logEvent('TelemetryPublishFailed', { channel: 'callytics:sip-status', error: err });
  }
}

export async function publishSipTraffic(event: SipTrafficEvent): Promise<void> {
  logEvent('TelemetryPublish', { channel: 'callytics:sip-traffic', method: event.method, direction: event.direction, callId: event.callId });
  try {
    await publish('callytics:sip-traffic', event);
  } catch (err) {
    logEvent('TelemetryPublishFailed', { channel: 'callytics:sip-traffic', error: err });
  }
}

export async function publishCallEvent(event: CallEvent): Promise<void> {
  logEvent('TelemetryPublish', { channel: 'callytics:call-events', type: event.type, callId: event.callId });
  try {
    await publish('callytics:call-events', event);
  } catch (err) {
    logEvent('TelemetryPublishFailed', { channel: 'callytics:call-events', error: err });
  }
}
