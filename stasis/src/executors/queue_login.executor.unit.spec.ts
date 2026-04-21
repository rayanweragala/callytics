const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

jest.mock('../db', () => ({ query: jest.fn() }));
import { query } from '../db';
const mockQuery = query as jest.MockedFunction<typeof query>;
import * as bcrypt from 'bcrypt';
import { EventEmitter } from 'events';

jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));
import { resolveAudioMediaPath } from '../audioResolver';
const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;

jest.mock('../engine/queueManager', () => ({
  loginOperator: jest.fn().mockResolvedValue(undefined),
  logoutOperator: jest.fn().mockResolvedValue(undefined),
}));

import { executeQueueLogin } from './queue_login.executor';

describe('queue_login.executor', () => {
  const fakeChannel = {
    id: 'ch-1',
    play: jest.fn().mockResolvedValue(undefined),
    hangup: jest.fn().mockResolvedValue(undefined),
  };

  const fakeAri = {
    Playback: jest.fn(() => ({ id: 'playback-1' })),
    bridges: {
      play: jest.fn().mockResolvedValue(undefined),
    },
    on: jest.fn(),
    removeListener: jest.fn(),
    channels: {
      startMoh: jest.fn().mockResolvedValue(undefined),
      stopMoh: jest.fn().mockResolvedValue(undefined),
    },
  };

  function makeSession() {
    return {
      callUuid: 'call-1',
      channelId: 'ch-1',
      callerNumber: '555-0100',
      currentNodeKey: 'queue-login-1',
      variables: {} as Record<string, unknown>,
      startedAt: new Date(),
      recording: null,
      inboundBridge: null,
      flow: {
        id: 1,
        name: 'Test Flow',
        versionId: 1,
        nodes: [
          { nodeKey: 'menu-1', type: 'menu', label: 'Menu', config: { invalid_prompt_audio_id: 9 } },
          { nodeKey: 'queue-login-1', type: 'queue_login', label: 'Queue Login', config: { queue_id: 1 } },
        ],
        edges: [
          { sourceNodeKey: 'menu-1', targetNodeKey: 'queue-login-1', branchKey: '9', condition: '9' },
        ],
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue('callytics/invalid');
  });

  it('routes back to source menu and plays invalid prompt when operator auth cannot start', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1, pin_retry_attempts: 3 }] as any)
      .mockResolvedValueOnce([] as any);

    const node = { nodeKey: 'queue-login-1', config: { queue_id: 1 } };
    const result = await executeQueueLogin(fakeChannel as any, node as any, makeSession() as any, fakeAri as any);

    expect(result).toBe('route:menu-1');
    expect(fakeChannel.play).toHaveBeenCalledWith({ media: 'sound:callytics/invalid' }, expect.anything());
  });

  it('returns failed when there is no source menu edge for fallback routing', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1, pin_retry_attempts: 3 }] as any)
      .mockResolvedValueOnce([] as any);

    const session = makeSession();
    session.flow.edges = [{ sourceNodeKey: 'start', targetNodeKey: 'queue-login-1', branchKey: 'default', condition: null }];

    const node = { nodeKey: 'queue-login-1', config: { queue_id: 1 } };
    const result = await executeQueueLogin(fakeChannel as any, node as any, session as any, fakeAri as any);

    expect(result).toBe('failed');
  });

  it('deduplicates mirrored DTMF events so entered PIN is not doubled', async () => {
    const pinHash = await bcrypt.hash('416178', 4);
    mockQuery
      .mockResolvedValueOnce([{ id: 1, pin_retry_attempts: 1 }] as any)
      .mockResolvedValueOnce([{ id: 7, pin_hash: pinHash }] as any);

    const ari = Object.assign(new EventEmitter(), {
      Playback: jest.fn(() => ({ id: 'playback-1' })),
      bridges: {
        play: jest.fn().mockResolvedValue(undefined),
      },
      channels: {
        startMoh: jest.fn().mockResolvedValue(undefined),
        stopMoh: jest.fn().mockResolvedValue(undefined),
      },
      removeListener: EventEmitter.prototype.removeListener,
    });

    const channel = Object.assign(new EventEmitter(), {
      id: 'ch-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
      removeListener: EventEmitter.prototype.removeListener,
    });

    const promise = executeQueueLogin(
      channel as any,
      { nodeKey: 'queue-login-1', config: { queue_id: 1 } } as any,
      makeSession() as any,
      ari as any,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    for (const digit of '416178') {
      const event = { channel: { id: 'ch-1' }, digit };
      ari.emit('ChannelDtmfReceived', event);
      channel.emit('ChannelDtmfReceived', event);
    }

    const logoutTicker = setInterval(() => {
      ari.emit('ChannelDtmfReceived', { channel: { id: 'ch-1' }, digit: '#' });
    }, 10);
    try {
      await expect(promise).resolves.toBe('authenticated');
    } finally {
      clearInterval(logoutTicker);
    }
    expect(ari.channels.startMoh).toHaveBeenCalledWith({ channelId: 'ch-1', mohClass: 'callytics-hold' });
    expect(ari.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'ch-1' });
  });

  it('prefers channel MOH even when inbound bridge exists', async () => {
    const pinHash = await bcrypt.hash('416178', 4);
    mockQuery
      .mockResolvedValueOnce([{ id: 1, pin_retry_attempts: 1 }] as any)
      .mockResolvedValueOnce([{ id: 7, pin_hash: pinHash }] as any);

    const ari = Object.assign(new EventEmitter(), {
      Playback: jest.fn(() => ({ id: 'playback-1' })),
      bridges: {
        play: jest.fn().mockResolvedValue(undefined),
        startMoh: jest.fn().mockResolvedValue(undefined),
        stopMoh: jest.fn().mockResolvedValue(undefined),
      },
      channels: {
        startMoh: jest.fn().mockResolvedValue(undefined),
        stopMoh: jest.fn().mockResolvedValue(undefined),
      },
      removeListener: EventEmitter.prototype.removeListener,
    });

    const channel = Object.assign(new EventEmitter(), {
      id: 'ch-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
      removeListener: EventEmitter.prototype.removeListener,
    });

    const session = makeSession() as any;
    session.inboundBridge = { id: 'bridge-inbound-1' };

    const promise = executeQueueLogin(
      channel as any,
      { nodeKey: 'queue-login-1', config: { queue_id: 1 } } as any,
      session,
      ari as any,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const digit of '416178') {
      const event = { channel: { id: 'ch-1' }, digit };
      ari.emit('ChannelDtmfReceived', event);
      channel.emit('ChannelDtmfReceived', event);
    }

    const logoutTicker = setInterval(() => {
      ari.emit('ChannelDtmfReceived', { channel: { id: 'ch-1' }, digit: '#' });
    }, 10);
    try {
      await expect(promise).resolves.toBe('authenticated');
    } finally {
      clearInterval(logoutTicker);
    }

    expect(ari.channels.startMoh).toHaveBeenCalledWith({ channelId: 'ch-1', mohClass: 'callytics-hold' });
    expect(ari.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'ch-1' });
    expect(ari.bridges.startMoh).not.toHaveBeenCalled();
  });

  it('interrupts prompt playback immediately on first PIN digit', async () => {
    const pinHash = await bcrypt.hash('416178', 4);
    mockQuery
      .mockResolvedValueOnce([{ id: 1, pin_retry_attempts: 1 }] as any)
      .mockResolvedValueOnce([{ id: 7, pin_hash: pinHash }] as any);

    const stopPlayback = jest.fn().mockResolvedValue(undefined);
    const ari = Object.assign(new EventEmitter(), {
      Playback: jest.fn(() => ({ id: 'playback-1', stop: stopPlayback })),
      bridges: {
        play: jest.fn().mockResolvedValue(undefined),
      },
      channels: {
        startMoh: jest.fn().mockResolvedValue(undefined),
        stopMoh: jest.fn().mockResolvedValue(undefined),
      },
      removeListener: EventEmitter.prototype.removeListener,
    });

    const channel = Object.assign(new EventEmitter(), {
      id: 'ch-1',
      play: jest.fn().mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 60)),
      ),
      hangup: jest.fn().mockResolvedValue(undefined),
      removeListener: EventEmitter.prototype.removeListener,
    });

    const promise = executeQueueLogin(
      channel as any,
      { nodeKey: 'queue-login-1', config: { queue_id: 1 } } as any,
      makeSession() as any,
      ari as any,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const digit of '416178') {
      ari.emit('ChannelDtmfReceived', { channel: { id: 'ch-1' }, digit });
    }
    const logoutTicker = setInterval(() => {
      ari.emit('ChannelDtmfReceived', { channel: { id: 'ch-1' }, digit: '#' });
    }, 10);

    try {
      await expect(promise).resolves.toBe('authenticated');
    } finally {
      clearInterval(logoutTicker);
    }

    expect(stopPlayback).toHaveBeenCalled();
  });
});
