jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));

jest.mock('../telemetry', () => ({
  publishNodeTelemetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../huntManager', () => ({
  registerHuntWaiter: jest.fn(),
  rejectHuntWaiter: jest.fn(),
}));

import { executeHunt } from './hunt.executor';
import { resolveAudioMediaPath } from '../audioResolver';
import { registerHuntWaiter, rejectHuntWaiter } from '../huntManager';
import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';

const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;
const registerHuntWaiterMock = registerHuntWaiter as jest.MockedFunction<typeof registerHuntWaiter>;
const rejectHuntWaiterMock = rejectHuntWaiter as jest.MockedFunction<typeof rejectHuntWaiter>;
const huntWaiters = new Map<string, (result: { answered: false; reason: 'failed' | 'destroyed' }) => void>();

function createSession(): CallSession {
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '1000',
    currentNodeKey: 'hunt-1',
    variables: {},
    startedAt: new Date(),
    recording: null,
    inboundBridge: { id: 'bridge-inbound-1' },
    flow: {
      id: 1,
      name: 'Test Flow',
      versionId: 1,
      nodes: [],
      edges: [],
    },
  };
}

function createAriClient() {
  const listeners = new Map<string, Set<(event: any) => void>>();

  return {
    Playback: jest.fn(() => ({
      id: 'playback-1',
      stop: jest.fn().mockResolvedValue(undefined),
    })),
    channels: {
      originate: jest.fn().mockResolvedValue(undefined),
    },
    bridges: {
      play: jest.fn().mockResolvedValue(undefined),
      addChannel: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue({ id: 'bridge-new-1' }),
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

async function flushPromises(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('hunt executor — additional coverage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    registerHuntWaiterMock.mockReset();
    rejectHuntWaiterMock.mockReset();
    huntWaiters.clear();
    registerHuntWaiterMock.mockImplementation(
      (token: string) => new Promise((resolve) => {
        huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
      }),
    );
    rejectHuntWaiterMock.mockImplementation((token, reason = 'failed') => {
      const resolve = huntWaiters.get(token);
      if (!resolve) return;
      huntWaiters.delete(token);
      resolve({ answered: false, reason });
    });
    resolveAudioMediaPathMock.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('sequential strategy retries next destination after first attempt timeout', async () => {
    const ariClient = createAriClient();
    const second = { id: 'hunt-2', hangup: jest.fn().mockResolvedValue(undefined) };
    registerHuntWaiterMock.mockReset();
    registerHuntWaiterMock
      .mockImplementationOnce((token: string) => new Promise((resolve) => {
        huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
      }))
      .mockReturnValueOnce(Promise.resolve({ answered: true, channel: second }));

    const node: FlowNode = {
      nodeKey: 'hunt-1',
      type: 'hunt',
      label: 'Hunt',
      config: {
        strategy: 'sequential',
        destinations: [{ target_type: 'extension', target_value: '2001' }, { target_type: 'extension', target_value: '2002' }],
        attempt_timeout_ms: 3000,
        total_timeout_ms: 10000,
        on_no_answer: 'fallback',
      },
    };

    const promise = executeHunt(
      { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) },
      node,
      createSession(),
      ariClient as any,
    );

    // First originate should go to 2001
    await flushPromises(20);
    expect(ariClient.channels.originate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ endpoint: 'PJSIP/2001' }),
    );

    // Let the first attempt timeout so we move to 2002
    await jest.advanceTimersByTimeAsync(3500);
    await flushPromises();

    expect(ariClient.channels.originate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ endpoint: 'PJSIP/2002' }),
    );

    await flushPromises(20);
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'bridge-inbound-1',
      channel: 'hunt-2',
    });

    // Inbound channel ends
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();

    await expect(promise).resolves.toBe('done');
    expect(second.hangup).toHaveBeenCalled();
  });

  it('bridges immediately when outbound leg reaches Stasis', async () => {
    const ariClient = createAriClient();
    const answered = { id: 'hunt-up-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerHuntWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: answered }),
    );

    const node: FlowNode = {
      nodeKey: 'hunt-1',
      type: 'hunt',
      label: 'Hunt',
      config: {
        strategy: 'sequential',
        destinations: [{ target_type: 'extension', target_value: '2001' }],
        attempt_timeout_ms: 3000,
        total_timeout_ms: 10000,
      },
    };

    const promise = executeHunt(
      { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) },
      node,
      createSession(),
      ariClient as any,
    );

    await flushPromises(20);
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'bridge-inbound-1',
      channel: 'hunt-up-1',
    });

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);

    await expect(promise).resolves.toBe('done');
    expect(answered.hangup).toHaveBeenCalled();
  });

  it('empty destinations array resolves immediately with route:<on_no_answer> without calling originate', async () => {
    const ariClient = createAriClient();

    const node: FlowNode = {
      nodeKey: 'hunt-1',
      type: 'hunt',
      label: 'Hunt',
      config: {
        destinations: [],
        attempt_timeout_ms: 5000,
        total_timeout_ms: 10000,
        on_no_answer: 'voicemail',
      },
    };

    const result = await executeHunt(
      { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) },
      node,
      createSession(),
      ariClient as any,
    );

    expect(result).toBe('route:voicemail');
    expect(ariClient.channels.originate).not.toHaveBeenCalled();
  });

  it('returns hangup immediately when inbound channel ends during hunt dial wait', async () => {
    // The waiter never resolves, so we simulate inbound hangup while the dial
    // attempt is in-flight and verify the executor exits as hangup (not fallback).
    const ariClient = createAriClient();
    registerHuntWaiterMock.mockReset();
    registerHuntWaiterMock.mockImplementation(
      (token: string) => new Promise((resolve) => {
        huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
      }),
    );

    const node: FlowNode = {
      nodeKey: 'hunt-1',
      type: 'hunt',
      label: 'Hunt',
      config: {
        destinations: [{ target_type: 'extension', target_value: '2001' }],
        // attempt_timeout_ms drives the internal race inside captureOriginatedChannel
        // (capped at min(attempt_timeout_ms, 5000)). Keep it short so the test runs fast.
        attempt_timeout_ms: 3000,
        total_timeout_ms: 3500,
        on_no_answer: 'fallback',
      },
    };

    const inboundChannel = { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) };
    const promise = executeHunt(inboundChannel, node, createSession(), ariClient as any);

    // Executor has started and called originate
    await flushPromises(20);
    expect(ariClient.channels.originate).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'PJSIP/2001' }),
    );

    // Simulate inbound hangup while we are still waiting for the outbound waiter
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();

    await jest.advanceTimersByTimeAsync(4000);
    await flushPromises();

    await expect(promise).resolves.toBe('hangup');
    expect(ariClient.channels.originate).toHaveBeenCalledTimes(1);
  });

  it('adds outbound leg to the recording bridge when agent answers', async () => {

    const ariClient = createAriClient();
    const agentChannel = {
      id: 'agent-channel-1',
      hangup: jest.fn().mockResolvedValue(undefined)
    };
    registerHuntWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: agentChannel }),
    );

    const session = createSession();
    session.recording = {
      name: 'call-1',
      fileName: 'call-1.wav',
      filePath: '/var/lib/asterisk/recording/call-1.wav',
      format: 'wav',
      startedAt: new Date(),
      endedAt: null,
    };

    const node: FlowNode = {
      nodeKey: 'hunt-1',
      type: 'hunt',
      label: 'Hunt',
      config: {
        strategy: 'sequential',
        destinations: [{ target_type: 'extension', target_value: 'agent-sip' }],
        attempt_timeout_ms: 5000,
        total_timeout_ms: 10000,
      },
    };

    const inboundChannel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined)
    };

    const promise = executeHunt(inboundChannel, node, session, ariClient as any);
    await flushPromises(20);

    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'bridge-inbound-1',
      channel: 'agent-channel-1',
    });

    expect(session.recording).not.toBeNull();
    expect(session.recording!.endedAt).toBeNull();

    ariClient.emit('StasisEnd', {channel: {id: 'channel-1'}});
    await flushPromises(20);

    await expect(promise).resolves.toBe('done');
  })
});
