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

export interface CallSession {
  callUuid: string;
  channelId: string;
  callerNumber: string;
  flow: Flow;
  currentNodeKey: string;
  variables: Record<string, string>;
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
  return {
    callUuid: channelId,
    channelId,
    callerNumber,
    flow,
    currentNodeKey: entryNodeKey,
    variables: {},
    startedAt: new Date(),
    recording: null,
    inboundBridge: null,
  };
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
