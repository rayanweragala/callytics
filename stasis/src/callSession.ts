import { Flow } from './flowLoader';

export interface CallRecordingState {
  name: string;
  fileName: string;
  filePath: string;
  format: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface InboundBridgeState {
  id: string;
}

export interface WebhookPayload {
  outcome?: {
    status: 'completed' | 'failed' | 'timeout' | 'no_answer' | 'abandoned';
    reason?: string;
  };
  bridge?: {
    connected_extension: string;
    connected_at: string;
    disconnected_at: string;
    talk_duration_seconds: number;
  };
  queue?: {
    queue_id: number;
    queue_name: string;
    wait_seconds: number;
    agent_extension: string | null;
    abandoned: boolean;
  };
  recording?: {
    url: string;
    duration_seconds: number;
  };
  callback?: {
    number: string;
    source: 'dtmf' | 'ani';
  };
}

export interface CallSession {
  callUuid: string;
  channelId: string;
  callerNumber: string;
  flow: Flow;
  currentNodeKey: string;
  variables: Record<string, string>;
  webhookPayload: WebhookPayload;
  call_started_at: string;
  call_ended_at: string | null;
  startedAt: Date;
  recording: CallRecordingState | null;
  inboundBridge: InboundBridgeState | null;
}

export function createSession(
  channelId: string,
  callerNumber: string,
  flow: Flow,
  entryNodeKey: string
): CallSession {
  const now = new Date();
  return {
    callUuid: channelId,
    channelId,
    callerNumber,
    flow,
    currentNodeKey: entryNodeKey,
    variables: {},
    webhookPayload: {},
    call_started_at: now.toISOString(),
    call_ended_at: null,
    startedAt: now,
    recording: null,
    inboundBridge: null,
  };
}

export function markCallEnded(
  session: CallSession,
  endedAt: Date = new Date(),
): string {
  if (session.call_ended_at) {
    return session.call_ended_at;
  }

  const isoTimestamp = endedAt.toISOString();
  session.call_ended_at = isoTimestamp;
  return isoTimestamp;
}

const activeSessions = new Map<string, CallSession>();

export function addSession(session: CallSession) {
  activeSessions.set(session.channelId, session);
}

export function getSession(channelId: string) {
  return activeSessions.get(channelId);
}

export function removeSession(channelId: string) {
  activeSessions.delete(channelId);
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}
