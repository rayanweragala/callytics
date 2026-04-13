import { Flow } from './flowLoader';

export interface CallSession {
  callUuid: string;
  channelId: string;
  callerNumber: string;
  flow: Flow;
  currentNodeKey: string;
  variables: Record<string, string>;
  startedAt: Date;
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
