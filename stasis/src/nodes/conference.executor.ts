import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { logEvent } from '../logger';
import { publish } from '../redis';
import { publishSipTraffic } from '../telemetry';

const DEFAULT_MOH_CLASS = process.env.QUEUE_LOGIN_MOH_CLASS || 'callytics-hold';
const SOLE_SURVIVOR_TIMEOUT_MS = 30_000;

interface ConferenceConfig {
  roomName?: string;
  waitForModerator?: boolean;
  moderatorType?: 'extension' | 'pstn' | null;
  moderatorId?: number | null;
}

interface ConferenceChannel {
  id: string;
  caller?: { number?: string };
  connected?: { number?: string };
  dialplan?: { exten?: string };
  dnid?: string;
}

interface AriLike {
  channels: {
    startMoh?: (params: { channelId: string; mohClass?: string }) => Promise<void>;
    stopMoh?: (params: { channelId: string }) => Promise<void>;
    hangup?: (params: { channelId: string }) => Promise<void>;
  };
  bridges: {
    create: (params: { type: string; bridgeId?: string; name?: string }) => Promise<{ id: string }>;
    addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
    destroy?: (params: { bridgeId: string }) => Promise<void>;
  };
  on: (event: string, listener: (event: { bridge?: { id?: string }; channel?: { id?: string; caller?: { number?: string } } }) => void) => void;
  removeListener: (event: string, listener: (event: { bridge?: { id?: string }; channel?: { id?: string; caller?: { number?: string } } }) => void) => void;
}

interface ConferenceRoomState {
  bridgeId: string;
  channels: Set<string>;
  mohChannels: Set<string>;
  callerIds: Map<string, string>;
  finishers: Map<string, () => void>;
  soleSurvivorTimer: NodeJS.Timeout | null;
  soleSurvivorChannelId: string | null;
}

const conferenceRooms = new Map<string, ConferenceRoomState>();

function roomBridgeId(roomName: string): string {
  return `conference-${roomName}`;
}

function comparableNumber(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function numbersMatch(left: unknown, right: unknown): boolean {
  const a = comparableNumber(left);
  const b = comparableNumber(right);
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}

async function fetchExtension(extensionId: number): Promise<{ id: number; username: string } | null> {
  try {
    const url = new URL('http://localhost:3001/extensions');
    url.searchParams.set('limit', '1000');
    url.searchParams.set('offset', '0');
    const res = await fetch(url.toString());
    if (!res.ok) {
      return null;
    }
    const payload = await res.json() as { data?: Array<{ id?: number; username?: string }> };
    const extension = (payload.data || []).find((item) => Number(item.id || 0) === extensionId);
    return extension?.username ? { id: extensionId, username: String(extension.username) } : null;
  } catch {
    return null;
  }
}

async function fetchOperator(operatorId: number): Promise<{ id: number; number: string } | null> {
  try {
    const url = new URL('http://localhost:3001/operators');
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '1000');
    const res = await fetch(url.toString());
    if (!res.ok) {
      return null;
    }
    const payload = await res.json() as {
      data?: Array<{
        id?: number;
        callbackNumber?: string | null;
        contactNumber?: { number?: string | null } | null;
      }>;
    };
    const operator = (payload.data || []).find((item) => Number(item.id || 0) === operatorId);
    const number = String(operator?.contactNumber?.number || operator?.callbackNumber || '').trim();
    return operator && number ? { id: operatorId, number } : null;
  } catch {
    return null;
  }
}

async function isModerator(channel: ConferenceChannel, session: CallSession, config: ConferenceConfig): Promise<boolean> {
  const moderatorId = Number(config.moderatorId || 0);
  if (!config.waitForModerator || !moderatorId) {
    return false;
  }

  if (config.moderatorType === 'extension') {
    const extension = await fetchExtension(moderatorId);
    if (!extension) {
      return false;
    }
    return [
      channel.caller?.number,
      channel.connected?.number,
      channel.dialplan?.exten,
      channel.dnid,
      session.callerNumber,
    ].some((value) => numbersMatch(value, extension.username) || String(value || '').trim() === extension.username);
  }

  if (config.moderatorType === 'pstn') {
    const operator = await fetchOperator(moderatorId);
    if (!operator) {
      return false;
    }
    return numbersMatch(channel.caller?.number || session.callerNumber, operator.number);
  }

  return false;
}

async function getOrCreateRoom(ariClient: AriLike, roomName: string): Promise<ConferenceRoomState> {
  const existing = conferenceRooms.get(roomName);
  if (existing) {
    return existing;
  }

  const bridgeId = roomBridgeId(roomName);
  try {
    await ariClient.bridges.create({ type: 'mixing', bridgeId, name: bridgeId });
    logEvent('BridgeCreated', { bridgeId, bridgeType: 'mixing' });
  } catch {
    // Fixed bridge ids make room reuse idempotent when the bridge already exists in ARI.
  }

  const state = {
    bridgeId,
    channels: new Set<string>(),
    mohChannels: new Set<string>(),
    callerIds: new Map<string, string>(),
    finishers: new Map<string, () => void>(),
    soleSurvivorTimer: null,
    soleSurvivorChannelId: null,
  };
  conferenceRooms.set(roomName, state);
  return state;
}

function cancelSoleSurvivorTimer(state: ConferenceRoomState): boolean {
  if (!state.soleSurvivorTimer) {
    return false;
  }
  clearTimeout(state.soleSurvivorTimer);
  state.soleSurvivorTimer = null;
  state.soleSurvivorChannelId = null;
  return true;
}

async function startMoh(ariClient: AriLike, state: ConferenceRoomState, channelId: string): Promise<void> {
  await ariClient.channels.startMoh?.({ channelId, mohClass: DEFAULT_MOH_CLASS }).catch(() => undefined);
  state.mohChannels.add(channelId);
}

async function stopMoh(ariClient: AriLike, state: ConferenceRoomState, channelId: string): Promise<void> {
  await ariClient.channels.stopMoh?.({ channelId }).catch(() => undefined);
  state.mohChannels.delete(channelId);
}

async function stopMohForAll(ariClient: AriLike, state: ConferenceRoomState): Promise<void> {
  await Promise.allSettled([...state.channels].map((channelId) => stopMoh(ariClient, state, channelId)));
}

async function publishConferenceEvent(
  session: CallSession,
  node: FlowNode,
  status: 'joined' | 'left',
  roomName: string,
  channelId: string,
  channelCount: number,
): Promise<void> {
  await publish('callytics:call-timeline', {
    callId: session.channelId,
    flowId: session.flow.id,
    nodeId: node.nodeKey,
    nodeType: node.type,
    status: status === 'joined' ? 'started' : 'completed',
    ts: Date.now(),
    meta: { result: status, roomName, channelId, channelCount },
  }).catch(() => undefined);
}

export async function executeConference(
  channel: ConferenceChannel,
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<'default'> {
  const client = ariClient as AriLike;
  const config = (node.config || {}) as ConferenceConfig;
  const roomName = String(config.roomName || '').trim();
  if (!roomName) {
    return 'default';
  }

  const moderator = await isModerator(channel, session, config);
  const room = await getOrCreateRoom(client, roomName);
  room.callerIds.set(channel.id, session.callerNumber);

  return await new Promise<'default'>((resolve) => {
    let settled = false;

    const cleanup = () => {
      room.finishers.delete(channel.id);
      room.callerIds.delete(channel.id);
      client.removeListener('ChannelLeftBridge', onLeftBridge);
      client.removeListener('StasisEnd', onChannelEnd);
      client.removeListener('ChannelDestroyed', onChannelEnd);
    };

    const startSoleSurvivorTimer = async () => {
      if (room.channels.size !== 1) {
        return;
      }
      const soleChannelId = [...room.channels][0];
      if (!soleChannelId) {
        return;
      }
      cancelSoleSurvivorTimer(room);
      await startMoh(client, room, soleChannelId);
      room.soleSurvivorChannelId = soleChannelId;
      logEvent('ConferenceSoleSurvivor', {
        bridgeId: room.bridgeId,
        channelId: soleChannelId,
        callerId: room.callerIds.get(soleChannelId) || '',
        timeoutMs: SOLE_SURVIVOR_TIMEOUT_MS,
      });
      room.soleSurvivorTimer = setTimeout(() => {
        void (async () => {
          if (room.channels.size !== 1 || !room.channels.has(soleChannelId)) {
            return;
          }
          logEvent('ConferenceTimeout', {
            bridgeId: room.bridgeId,
            channelId: soleChannelId,
            callerId: room.callerIds.get(soleChannelId) || '',
          });
          await client.channels.hangup?.({ channelId: soleChannelId }).catch(() => undefined);
          room.finishers.get(soleChannelId)?.();
        })();
      }, SOLE_SURVIVOR_TIMEOUT_MS);
    };

    const finish = async () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      await stopMoh(client, room, channel.id);
      room.channels.delete(channel.id);
      const channelCountAfter = room.channels.size;
      await publishConferenceEvent(session, node, 'left', roomName, channel.id, channelCountAfter);
      await publishSipTraffic({
        callId: session.channelId,
        timestamp: new Date().toISOString(),
        method: 'BYE',
        from: session.callerNumber,
        to: roomName,
        direction: 'inbound',
        responseCode: null,
        rawMessage: `BYE conference:${roomName} SIP/2.0`,
      }).catch(() => undefined);
      logEvent('ChannelLeftBridge', {
        bridgeId: room.bridgeId,
        channelId: channel.id,
        callerId: session.callerNumber,
        channelCountAfter,
      });
      if (channelCountAfter === 0) {
        cancelSoleSurvivorTimer(room);
        await client.bridges.destroy?.({ bridgeId: room.bridgeId }).catch(() => undefined);
        conferenceRooms.delete(roomName);
        logEvent('BridgeDestroyed', { bridgeId: room.bridgeId, channelCountAtDestroy: 0 });
      } else if (channelCountAfter === 1) {
        await startSoleSurvivorTimer();
      }
      resolve('default');
    };

    room.finishers.set(channel.id, () => {
      void finish();
    });

    const onLeftBridge = (event: { bridge?: { id?: string }; channel?: { id?: string } }) => {
      if (event.bridge?.id !== room.bridgeId || event.channel?.id !== channel.id) {
        return;
      }
      void finish();
    };

    const onChannelEnd = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) {
        return;
      }
      void finish();
    };

    client.on('ChannelLeftBridge', onLeftBridge);
    client.on('StasisEnd', onChannelEnd);
    client.on('ChannelDestroyed', onChannelEnd);

    void (async () => {
      if (moderator) {
        if (room.channels.size === 0) {
          await client.bridges.addChannel({ bridgeId: room.bridgeId, channel: channel.id });
          room.channels.add(channel.id);
          await startMoh(client, room, channel.id);
        } else {
          await client.bridges.addChannel({ bridgeId: room.bridgeId, channel: channel.id });
          room.channels.add(channel.id);
          const resumed = cancelSoleSurvivorTimer(room);
          await stopMohForAll(client, room);
          if (resumed) {
            logEvent('ConferenceResumed', { bridgeId: room.bridgeId, channelCountAfter: room.channels.size });
          }
        }
      } else {
        await client.bridges.addChannel({ bridgeId: room.bridgeId, channel: channel.id });
        room.channels.add(channel.id);
        const resumed = cancelSoleSurvivorTimer(room);
        if (resumed) {
          await stopMohForAll(client, room);
          logEvent('ConferenceResumed', { bridgeId: room.bridgeId, channelCountAfter: room.channels.size });
        } else if (config.waitForModerator || room.channels.size === 1) {
          await startMoh(client, room, channel.id);
        } else {
          await stopMohForAll(client, room);
        }
      }

      const channelCountAfter = room.channels.size;
      await publishConferenceEvent(session, node, 'joined', roomName, channel.id, channelCountAfter);
      await publishSipTraffic({
        callId: session.channelId,
        timestamp: new Date().toISOString(),
        method: 'INVITE',
        from: session.callerNumber,
        to: roomName,
        direction: 'inbound',
        responseCode: null,
        rawMessage: `INVITE conference:${roomName} SIP/2.0`,
      }).catch(() => undefined);
      logEvent('ChannelEnteredBridge', {
        bridgeId: room.bridgeId,
        channelId: channel.id,
        callerId: session.callerNumber,
        channelCountAfter,
      });
    })().catch(() => {
      cleanup();
      resolve('default');
    });
  });
}
