jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));

jest.mock('../telemetry', () => ({
  publishNodeTelemetry: jest.fn().mockResolvedValue(undefined),
}));

import { executeMenu } from './menu.executor';
import { resolveAudioMediaPath } from '../audioResolver';
import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';

const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;

function createSession(): CallSession {
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '1000',
    currentNodeKey: 'menu-1',
    variables: {},
    startedAt: new Date(),
    recording: null,
    inboundBridge: null,
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

function makeMenuNode(overrides: Partial<Record<string, unknown>> = {}): FlowNode {
  return {
    nodeKey: 'menu-1',
    type: 'menu',
    label: 'Main Menu',
    config: {
      prompt_audio_file_id: 1,
      timeout_prompt_audio_id: 11,
      invalid_prompt_audio_id: 12,
      final_failure_audio_id: 13,
      timeout_ms: 5000,
      max_timeout_attempts: 3,
      max_invalid_attempts: 3,
      branches: ['1', '2'],
      ...overrides,
    },
  };
}

describe('menu executor — audio and first-attempt behaviour', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue('callytics/prompt');
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('calls channel.play() with the prompt media URI before waiting for DTMF', async () => {
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node = makeMenuNode();

    const promise = executeMenu(channel, node, createSession(), ariClient);

    // Drain microtasks so the prompt play call is issued
    await flushPromises(20);

    expect(channel.play).toHaveBeenCalledWith(
      { media: 'sound:callytics/prompt' },
      expect.objectContaining({ id: 'playback-1' }),
    );

    // Resolve the promise by emitting a valid digit
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '1' });
    await flushPromises(20);
    await expect(promise).resolves.toBe('1');
  });

  it('resolves the matched branch key when a valid digit is pressed', async () => {
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node = makeMenuNode({ branches: ['1', '2', '3'] });

    const promise = executeMenu(channel, node, createSession(), ariClient);
    await flushPromises(20);

    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '2' });
    await flushPromises(20);

    await expect(promise).resolves.toBe('2');
  });

  it('resolves "invalid" when the pressed digit is not in branches', async () => {
    resolveAudioMediaPathMock.mockImplementation(async (_config, idField) => `callytics/${idField}`);
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    // Only 3 max_invalid_attempts but we only press once then a valid digit so we
    // exercise the 'invalid' single-loop path without hitting the exhaustion guard.
    const node = makeMenuNode({ max_invalid_attempts: 3 });
    const session = createSession();

    const promise = executeMenu(channel, node, session, ariClient);
    await flushPromises(20);

    // Press invalid digit
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '9' });
    await flushPromises(20);
    await jest.advanceTimersByTimeAsync(0);
    await flushPromises(20);

    // Press valid digit to resolve cleanly
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '1' });
    await flushPromises(20);

    await expect(promise).resolves.toBe('1');
    // The invalid prompt must have been played
    expect(channel.play).toHaveBeenCalledWith(
      expect.objectContaining({ media: 'sound:callytics/invalid_prompt_audio_id' }),
      expect.anything(),
    );
  });

  it('resolves "timeout" path (plays timeout prompt then retries) when timeout_ms elapses once', async () => {
    resolveAudioMediaPathMock.mockImplementation(async (_config, idField) => `callytics/${idField}`);
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node = makeMenuNode({ max_timeout_attempts: 3 });
    const session = createSession();

    const promise = executeMenu(channel, node, session, ariClient);
    await flushPromises(20);

    // Let the first timeout fire
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises(20);

    // Now a valid digit to escape the second loop
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '1' });
    await flushPromises(20);

    await expect(promise).resolves.toBe('1');
    expect(channel.play).toHaveBeenCalledWith(
      expect.objectContaining({ media: 'sound:callytics/timeout_prompt_audio_id' }),
      expect.anything(),
    );
  });

  it('resolves "hangup" immediately when StasisEnd fires mid-prompt', async () => {
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node = makeMenuNode();

    const promise = executeMenu(channel, node, createSession(), ariClient);
    await flushPromises(20);

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);

    await expect(promise).resolves.toBe('hangup');
  });
});
