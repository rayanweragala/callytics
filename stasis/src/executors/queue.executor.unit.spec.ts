const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  sCard: jest.fn().mockResolvedValue(0),
  sPop: jest.fn().mockResolvedValue(null),
  sAdd: jest.fn().mockResolvedValue(undefined),
  rPush: jest.fn().mockResolvedValue(undefined),
  lRem: jest.fn().mockResolvedValue(undefined),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  removeListener: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

jest.mock('../db', () => ({ query: jest.fn() }));
import { query } from '../db';
const mockQuery = query as jest.MockedFunction<typeof query>;

jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));
import { resolveAudioMediaPath } from '../audioResolver';
const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;

jest.mock('../engine/queueManager', () => ({
  onCustomerHangup: jest.fn().mockResolvedValue(undefined),
}));

import { executeQueue } from './queue.executor';

describe('queue.executor', () => {
  function makeSession() {
    return {
      callUuid: 'call-1',
      channelId: 'ch-1',
      callerNumber: '555-0100',
      currentNodeKey: 'n-1',
      variables: {} as Record<string, unknown>,
      webhookPayload: {},
      startedAt: new Date(),
      recording: null,
      inboundBridge: null,
      flow: { id: 1, name: 'Test', versionId: 1, nodes: [], edges: [] },
    };
  }

  const fakeChannel = { id: 'ch-1', play: jest.fn(), hangup: jest.fn() };

  function createAriClient() {
    const listeners = new Map<string, Array<(event: unknown) => void>>();
    return {
      listeners,
      on(event: string, listener: (event: unknown) => void) {
        if (!listeners.has(event)) {
          listeners.set(event, []);
        }
        listeners.get(event)!.push(listener);
      },
      removeListener(event: string, listener: (event: unknown) => void) {
        if (!listeners.has(event)) return;
        const arr = listeners.get(event)!;
        const idx = arr.indexOf(listener);
        if (idx !== -1) arr.splice(idx, 1);
      },
      emit(event: string, payload: unknown) {
        if (!listeners.has(event)) return;
        const arr = [...listeners.get(event)!];
        arr.forEach((fn) => fn(payload));
      },
      Playback: jest.fn(() => ({ id: 'playback-1' })),
      bridges: {
        play: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue({ id: 'bridge-x' }),
        addChannel: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      },
      channels: {
        originate: jest.fn().mockResolvedValue(undefined),
        stopMoh: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  const flushPromises = () => new Promise(setImmediate);

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns abandoned immediately when no queue_id configured', async () => {
    const ariClient = createAriClient();
    const session = makeSession();
    const node = { config: {} };

    const result = await executeQueue(fakeChannel, node as any, session as any, ariClient);

    expect(result).toBe('abandoned');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns abandoned when queue not found in DB', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const ariClient = createAriClient();
    const session = makeSession();
    const node = { config: { queue_id: 1 } };

    const result = await executeQueue(fakeChannel, node as any, session as any, ariClient);

    expect(result).toBe('abandoned');
  });

  it('plays configured queue prompt before queueing when prompt audio resolves', async () => {
    resolveAudioMediaPathMock.mockResolvedValueOnce('callytics/queue-enter');
    mockQuery.mockResolvedValueOnce([{ id: 1, max_wait_seconds: 300, wait_audio_file_id: null }] as any);
    mockRedisClient.sCard.mockResolvedValueOnce(0);

    const ariClient = createAriClient();
    const session = makeSession();
    session.inboundBridge = { id: 'bridge-inbound-1' } as any;
    const node = { config: { queue_id: 1, prompt_audio_file_id: 99 } };

    const promise = executeQueue(fakeChannel, node as any, session as any, ariClient);
    await flushPromises();

    expect(ariClient.bridges.play).toHaveBeenCalledWith(expect.objectContaining({
      bridgeId: 'bridge-inbound-1',
      media: 'sound:callytics/queue-enter',
    }));

    ariClient.emit('StasisEnd', { channel: { id: 'ch-1' } });
    const result = await promise;
    expect(result).toBe('abandoned');
  });

  it('bridges customer to free operator and returns connected', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, max_wait_seconds: 300, wait_audio_file_id: null }] as any);
    mockRedisClient.sCard.mockResolvedValueOnce(1);
    mockRedisClient.sPop.mockResolvedValueOnce('42');
    mockRedisClient.get.mockResolvedValueOnce('op-channel-1');

    const ariClient = createAriClient();
    ariClient.bridges.create.mockResolvedValueOnce({ id: 'bridge-x' } as any);
    const session = makeSession();
    const node = { config: { queue_id: 1 } };

    const promise = executeQueue(fakeChannel, node as any, session as any, ariClient);
    await flushPromises();

    ariClient.emit('StasisEnd', { channel: { id: 'ch-1' } });
    const result = await promise;

    expect(result).toBe('connected');
    expect(ariClient.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'op-channel-1' });
    expect(ariClient.bridges.addChannel).toHaveBeenCalledTimes(2);
  });

  it('puts operator back and waits when operator channel is missing', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, max_wait_seconds: 300, wait_audio_file_id: null }] as any);
    mockRedisClient.sCard.mockResolvedValueOnce(1);
    mockRedisClient.sPop.mockResolvedValueOnce('42');
    mockRedisClient.get.mockResolvedValueOnce(null);

    const ariClient = createAriClient();
    const session = makeSession();
    const node = { config: { queue_id: 1 } };

    const promise = executeQueue(fakeChannel, node as any, session as any, ariClient);
    await flushPromises();

    expect(mockRedisClient.sAdd).toHaveBeenCalledWith('queue:1:operators', '42');
    expect(mockRedisClient.rPush).toHaveBeenCalledWith('queue:1:waiting', 'ch-1');

    ariClient.emit('StasisEnd', { channel: { id: 'ch-1' } });
    const result = await promise;

    expect(result).toBe('abandoned');
  });

  it('returns abandoned when customer hangs up while waiting', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, max_wait_seconds: 300, wait_audio_file_id: null }] as any);
    mockRedisClient.sCard.mockResolvedValueOnce(0);

    const ariClient = createAriClient();
    const session = makeSession();
    const node = { config: { queue_id: 1 } };

    const promise = executeQueue(fakeChannel, node as any, session as any, ariClient);
    await flushPromises();

    expect(mockRedisClient.rPush).toHaveBeenCalled();

    ariClient.emit('StasisEnd', { channel: { id: 'ch-1' } });
    const result = await promise;

    expect(mockRedisClient.lRem).toHaveBeenCalled();
    expect(result).toBe('abandoned');
  });

  it('keeps caller waiting until max wait is reached, then returns timeout', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, max_wait_seconds: 1, wait_audio_file_id: null }] as any);
    mockRedisClient.sCard.mockResolvedValueOnce(0);

    const ariClient = createAriClient();
    const session = makeSession();
    const node = { config: { queue_id: 1 } };

    const promise = executeQueue(fakeChannel, node as any, session as any, ariClient);
    await flushPromises();

    await expect(promise).resolves.toBe('timeout');
    expect(mockRedisClient.rPush).toHaveBeenCalledWith('queue:1:waiting', 'ch-1');
    expect(mockRedisClient.lRem).toHaveBeenCalledWith('queue:1:waiting', 1, 'ch-1');
  });

  it('connects waiting customer as soon as operator becomes available', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, max_wait_seconds: 30, wait_audio_file_id: null }] as any);
    mockRedisClient.sCard.mockResolvedValueOnce(0);
    mockRedisClient.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('op-channel-42');

    const ariClient = createAriClient();
    const session = makeSession();
    const node = { config: { queue_id: 1 } };

    const promise = executeQueue(fakeChannel, node as any, session as any, ariClient);
    await flushPromises();
    expect(mockRedisClient.rPush).toHaveBeenCalledWith('queue:1:waiting', 'ch-1');
    await expect(promise).resolves.toBe('connected');
  });

});
