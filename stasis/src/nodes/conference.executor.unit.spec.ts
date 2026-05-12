jest.mock('../redis', () => ({
  publish: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../telemetry', () => ({
  publishSipTraffic: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../logger', () => ({
  logEvent: jest.fn(),
  stasisLogger: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { executeConference } from './conference.executor';
import { publish } from '../redis';
import { publishSipTraffic } from '../telemetry';
import { logEvent } from '../logger';
import type { CallSession } from '../callSession';
import type { FlowNode } from '../flowLoader';

const publishMock = publish as jest.MockedFunction<typeof publish>;
const publishSipTrafficMock = publishSipTraffic as jest.MockedFunction<typeof publishSipTraffic>;
const logEventMock = logEvent as jest.MockedFunction<typeof logEvent>;
const fetchMock = jest.spyOn(globalThis, 'fetch');

function createSession(callId = 'call-1'): CallSession {
  const startedAt = new Date();
  return {
    callUuid: callId,
    channelId: callId,
    callerNumber: '1000',
    currentNodeKey: 'conference-1',
    variables: {},
    webhookPayload: {},
    call_started_at: startedAt.toISOString(),
    call_ended_at: null,
    startedAt,
    recording: null,
    inboundBridge: { id: 'bridge-inbound-1' },
    flow: {
      id: 77,
      name: 'Test Flow',
      versionId: 1,
      nodes: [],
      edges: [],
    },
  };
}

function createChannel(id: string, callerNumber: string) {
  return {
    id,
    caller: { number: callerNumber },
    connected: { number: callerNumber },
    dialplan: { exten: callerNumber },
    dnid: callerNumber,
    hangup: jest.fn().mockResolvedValue(undefined),
  };
}

function createAriClient() {
  const listeners = new Map<string, Set<(event: any) => void>>();

  return {
    channels: {
      startMoh: jest.fn().mockResolvedValue(undefined),
      stopMoh: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    },
    bridges: {
      create: jest.fn().mockResolvedValue({ id: 'conference-SalesRoom1' }),
      addChannel: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    },
    on: jest.fn((event: string, listener: (event: any) => void) => {
      const set = listeners.get(event) || new Set();
      set.add(listener);
      listeners.set(event, set);
    }),
    removeListener: jest.fn((event: string, listener: (event: any) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit(event: string, payload: any) {
      for (const listener of Array.from(listeners.get(event) || [])) {
        listener(payload);
      }
    },
  };
}

function createNode(config: Record<string, unknown>): FlowNode {
  return {
    nodeKey: 'conference-1',
    type: 'conference',
    label: 'Conference Room',
    config,
  };
}

function mockResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

async function flushPromises(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('conference executor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(mockResponse({ data: [] }) as Response);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  it('starts MOH for the first channel to join the bridge', async () => {
    const ariClient = createAriClient();
    const session = createSession('call-first');
    const node = createNode({
      roomName: 'SalesRoom1',
      waitForModerator: false,
      moderatorType: null,
      moderatorId: null,
    });
    const channel = createChannel('conf-first', '1000');

    const promise = executeConference(channel as never, node, session, ariClient as never);
    await flushPromises(20);

    expect(ariClient.bridges.create).toHaveBeenCalledWith({
      type: 'mixing,dtmf_events',
      bridgeId: 'conference-SalesRoom1',
      name: 'conference-SalesRoom1',
    });
    expect(ariClient.channels.startMoh).toHaveBeenCalledWith({
      channelId: 'conf-first',
      mohClass: 'callytics-hold',
    });

    ariClient.emit('StasisEnd', { channel: { id: 'conf-first' } });
    await flushPromises(20);

    await expect(promise).resolves.toBe('default');
    expect(ariClient.bridges.destroy).toHaveBeenCalledWith({ bridgeId: 'conference-SalesRoom1' });
  });

  it('stops MOH on all channels and bridges them when a second channel joins', async () => {
    const ariClient = createAriClient();
    const sessionA = createSession('call-second-a');
    const sessionB = createSession('call-second-b');
    const node = createNode({
      roomName: 'SupportRoom1',
      waitForModerator: false,
      moderatorType: null,
      moderatorId: null,
    });
    const firstChannel = createChannel('conf-second-a', '1000');
    const secondChannel = createChannel('conf-second-b', '1001');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-SupportRoom1' });

    const firstPromise = executeConference(firstChannel as never, node, sessionA, ariClient as never);
    await flushPromises(20);

    const secondPromise = executeConference(secondChannel as never, node, sessionB, ariClient as never);
    await flushPromises(20);

    expect(ariClient.channels.startMoh).toHaveBeenCalledTimes(1);
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-second-a' });
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-second-b' });
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'conference-SupportRoom1',
      channel: 'conf-second-b',
    });

    ariClient.emit('StasisEnd', { channel: { id: 'conf-second-b' } });
    ariClient.emit('StasisEnd', { channel: { id: 'conf-second-a' } });
    await flushPromises(20);

    await expect(firstPromise).resolves.toBe('default');
    await expect(secondPromise).resolves.toBe('default');
  });

  it('starts MOH on the sole survivor and arms the 30 second timer', async () => {
    const ariClient = createAriClient();
    const sessionA = createSession('call-survivor-a');
    const sessionB = createSession('call-survivor-b');
    const node = createNode({
      roomName: 'TimerRoom',
      waitForModerator: false,
      moderatorType: null,
      moderatorId: null,
    });
    const firstChannel = createChannel('conf-survivor-a', '1000');
    const secondChannel = createChannel('conf-survivor-b', '1001');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-TimerRoom' });

    const firstPromise = executeConference(firstChannel as never, node, sessionA, ariClient as never);
    await flushPromises(20);

    const secondPromise = executeConference(secondChannel as never, node, sessionB, ariClient as never);
    await flushPromises(20);

    ariClient.emit('StasisEnd', { channel: { id: 'conf-survivor-b' } });
    await flushPromises(20);

    expect(ariClient.channels.startMoh).toHaveBeenCalledTimes(2);
    expect(ariClient.channels.startMoh).toHaveBeenLastCalledWith({
      channelId: 'conf-survivor-a',
      mohClass: 'callytics-hold',
    });

    await jest.advanceTimersByTimeAsync(29_999);
    expect(ariClient.channels.hangup).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await flushPromises(20);

    expect(ariClient.channels.hangup).toHaveBeenCalledWith({ channelId: 'conf-survivor-a' });

    await expect(firstPromise).resolves.toBe('default');
    await expect(secondPromise).resolves.toBe('default');
  });

  it('cancels the timer and stops MOH when another channel rejoins before timeout', async () => {
    const ariClient = createAriClient();
    const sessionA = createSession('call-rejoin-a');
    const sessionB = createSession('call-rejoin-b');
    const sessionC = createSession('call-rejoin-c');
    const node = createNode({
      roomName: 'RejoinRoom',
      waitForModerator: false,
      moderatorType: null,
      moderatorId: null,
    });
    const firstChannel = createChannel('conf-rejoin-a', '1000');
    const secondChannel = createChannel('conf-rejoin-b', '1001');
    const rejoinChannel = createChannel('conf-rejoin-c', '1002');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-RejoinRoom' });

    const firstPromise = executeConference(firstChannel as never, node, sessionA, ariClient as never);
    await flushPromises(20);

    const secondPromise = executeConference(secondChannel as never, node, sessionB, ariClient as never);
    await flushPromises(20);

    ariClient.emit('StasisEnd', { channel: { id: 'conf-rejoin-b' } });
    await flushPromises(20);

    const rejoinPromise = executeConference(rejoinChannel as never, node, sessionC, ariClient as never);
    await flushPromises(20);

    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-rejoin-a' });
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-rejoin-c' });

    await jest.advanceTimersByTimeAsync(30_000);
    expect(ariClient.channels.hangup).not.toHaveBeenCalled();

    ariClient.emit('StasisEnd', { channel: { id: 'conf-rejoin-c' } });
    ariClient.emit('StasisEnd', { channel: { id: 'conf-rejoin-a' } });
    await flushPromises(20);

    await expect(firstPromise).resolves.toBe('default');
    await expect(secondPromise).resolves.toBe('default');
    await expect(rejoinPromise).resolves.toBe('default');
  });

  it('hangs up the sole survivor and destroys the bridge when the timer fires', async () => {
    const ariClient = createAriClient();
    const sessionA = createSession('call-timeout-a');
    const sessionB = createSession('call-timeout-b');
    const node = createNode({
      roomName: 'TimeoutRoom',
      waitForModerator: false,
      moderatorType: null,
      moderatorId: null,
    });
    const firstChannel = createChannel('conf-timeout-a', '1000');
    const secondChannel = createChannel('conf-timeout-b', '1001');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-TimeoutRoom' });

    const firstPromise = executeConference(firstChannel as never, node, sessionA, ariClient as never);
    await flushPromises(20);

    const secondPromise = executeConference(secondChannel as never, node, sessionB, ariClient as never);
    await flushPromises(20);

    ariClient.emit('StasisEnd', { channel: { id: 'conf-timeout-b' } });
    await flushPromises(20);

    await jest.advanceTimersByTimeAsync(30_000);
    await flushPromises(20);

    expect(ariClient.channels.hangup).toHaveBeenCalledWith({ channelId: 'conf-timeout-a' });
    expect(ariClient.bridges.destroy).toHaveBeenCalledWith({ bridgeId: 'conference-TimeoutRoom' });

    await expect(firstPromise).resolves.toBe('default');
    await expect(secondPromise).resolves.toBe('default');
  });

  it('keeps a non-moderator channel in MOH while wait-for-moderator is enabled', async () => {
    const ariClient = createAriClient();
    const session = createSession('call-waiting');
    const node = createNode({
      roomName: 'WaitRoom',
      waitForModerator: true,
      moderatorType: null,
      moderatorId: null,
    });
    const channel = createChannel('conf-waiting', '1000');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-WaitRoom' });

    const promise = executeConference(channel as never, node, session, ariClient as never);
    await flushPromises(20);

    expect(ariClient.channels.startMoh).toHaveBeenCalledWith({
      channelId: 'conf-waiting',
      mohClass: 'callytics-hold',
    });
    expect(ariClient.channels.stopMoh).not.toHaveBeenCalled();

    ariClient.emit('StasisEnd', { channel: { id: 'conf-waiting' } });
    await flushPromises(20);

    await expect(promise).resolves.toBe('default');
  });

  it('resolves a matching extension moderator and bridges waiting channels', async () => {
    fetchMock.mockImplementation(async (input) => {
      expect(String(input)).toContain('/extensions');
      return mockResponse({
        data: [
          { id: 11, username: '2001' },
        ],
      });
    });

    const ariClient = createAriClient();
    const waitingSession = createSession('call-extension-waiting');
    const moderatorSession = createSession('call-extension-moderator');
    const node = createNode({
      roomName: 'ModeratorRoom',
      waitForModerator: true,
      moderatorType: 'extension',
      moderatorId: 11,
    });
    const waitingChannel = createChannel('conf-extension-waiting', '1000');
    const moderatorChannel = createChannel('conf-extension-moderator', '2001');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-ModeratorRoom' });

    const waitingPromise = executeConference(waitingChannel as never, node, waitingSession, ariClient as never);
    await flushPromises(20);

    const moderatorPromise = executeConference(moderatorChannel as never, node, moderatorSession, ariClient as never);
    await flushPromises(20);

    expect(ariClient.channels.startMoh).toHaveBeenCalledWith({
      channelId: 'conf-extension-waiting',
      mohClass: 'callytics-hold',
    });
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-extension-waiting' });
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-extension-moderator' });
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'conference-ModeratorRoom',
      channel: 'conf-extension-moderator',
    });

    ariClient.emit('StasisEnd', { channel: { id: 'conf-extension-moderator' } });
    ariClient.emit('StasisEnd', { channel: { id: 'conf-extension-waiting' } });
    await flushPromises(20);

    await expect(waitingPromise).resolves.toBe('default');
    await expect(moderatorPromise).resolves.toBe('default');
  });

  it('resolves a matching PSTN operator moderator and bridges waiting channels', async () => {
    fetchMock.mockImplementation(async (input) => {
      expect(String(input)).toContain('/operators');
      return mockResponse({
        data: [
          { id: 21, name: 'Main Operator', callbackNumber: '+94770000000' },
        ],
      });
    });

    const ariClient = createAriClient();
    const waitingSession = createSession('call-operator-waiting');
    const moderatorSession = createSession('call-operator-moderator');
    const node = createNode({
      roomName: 'OperatorRoom',
      waitForModerator: true,
      moderatorType: 'pstn',
      moderatorId: 21,
    });
    const waitingChannel = createChannel('conf-operator-waiting', '1000');
    const moderatorChannel = createChannel('conf-operator-moderator', '+94770000000');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-OperatorRoom' });

    const waitingPromise = executeConference(waitingChannel as never, node, waitingSession, ariClient as never);
    await flushPromises(20);

    const moderatorPromise = executeConference(moderatorChannel as never, node, moderatorSession, ariClient as never);
    await flushPromises(20);

    expect(ariClient.channels.startMoh).toHaveBeenCalledWith({
      channelId: 'conf-operator-waiting',
      mohClass: 'callytics-hold',
    });
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-operator-waiting' });
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'conf-operator-moderator' });
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'conference-OperatorRoom',
      channel: 'conf-operator-moderator',
    });

    ariClient.emit('StasisEnd', { channel: { id: 'conf-operator-moderator' } });
    ariClient.emit('StasisEnd', { channel: { id: 'conf-operator-waiting' } });
    await flushPromises(20);

    await expect(waitingPromise).resolves.toBe('default');
    await expect(moderatorPromise).resolves.toBe('default');
  });

  it('emits Redis timeline events on channel join and leave with the conference room metadata', async () => {
    const ariClient = createAriClient();
    const session = createSession('call-redis');
    const node = createNode({
      roomName: 'RedisRoom',
      waitForModerator: false,
      moderatorType: null,
      moderatorId: null,
    });
    const channel = createChannel('conf-redis', '1000');

    (ariClient.bridges.create as jest.Mock).mockResolvedValueOnce({ id: 'conference-RedisRoom' });

    const promise = executeConference(channel as never, node, session, ariClient as never);
    await flushPromises(20);

    expect(publishMock).toHaveBeenCalledWith(
      'callytics:call-timeline',
      expect.objectContaining({
        callId: 'call-redis',
        flowId: 77,
        nodeId: 'conference-1',
        nodeType: 'conference',
        status: 'started',
        meta: expect.objectContaining({
          result: 'joined',
          roomName: 'RedisRoom',
          channelId: 'conf-redis',
          channelCount: 1,
        }),
      }),
    );

    ariClient.emit('StasisEnd', { channel: { id: 'conf-redis' } });
    await flushPromises(20);

    expect(publishMock).toHaveBeenCalledWith(
      'callytics:call-timeline',
      expect.objectContaining({
        callId: 'call-redis',
        flowId: 77,
        nodeId: 'conference-1',
        nodeType: 'conference',
        status: 'completed',
        meta: expect.objectContaining({
          result: 'left',
          roomName: 'RedisRoom',
          channelId: 'conf-redis',
          channelCount: 0,
        }),
      }),
    );

    expect(publishSipTrafficMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'INVITE',
      to: 'RedisRoom',
    }));
    expect(publishSipTrafficMock).toHaveBeenCalledWith(expect.objectContaining({
      method: 'BYE',
      to: 'RedisRoom',
    }));
    expect(logEventMock).toHaveBeenCalled();

    await expect(promise).resolves.toBe('default');
  });
});
