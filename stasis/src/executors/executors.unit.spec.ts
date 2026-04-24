jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));

jest.mock('../telemetry', () => ({
  publishNodeTelemetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../transferManager', () => ({
  registerTransferWaiter: jest.fn(),
  rejectTransferWaiter: jest.fn(),
}));

jest.mock('../huntManager', () => ({
  registerHuntWaiter: jest.fn(),
  rejectHuntWaiter: jest.fn(),
}));

jest.mock('../db', () => ({
  query: jest.fn(),
}));

import { executeNode } from '../nodes';
import { executeHunt } from '../nodes/hunt.executor';
import { resolveAudioMediaPath } from '../audioResolver';
import { registerTransferWaiter, rejectTransferWaiter } from '../transferManager';
import { registerHuntWaiter, rejectHuntWaiter } from '../huntManager';
import { query } from '../db';
import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';

const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;
const registerTransferWaiterMock = registerTransferWaiter as jest.MockedFunction<typeof registerTransferWaiter>;
const rejectTransferWaiterMock = rejectTransferWaiter as jest.MockedFunction<typeof rejectTransferWaiter>;
const registerHuntWaiterMock = registerHuntWaiter as jest.MockedFunction<typeof registerHuntWaiter>;
const rejectHuntWaiterMock = rejectHuntWaiter as jest.MockedFunction<typeof rejectHuntWaiter>;
const queryMock = query as jest.MockedFunction<typeof query>;
const huntWaiters = new Map<string, (result: { answered: false; reason: 'failed' | 'destroyed' }) => void>();

function createSession(): CallSession {
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '1000',
    currentNodeKey: 'node-1',
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
      play: jest.fn().mockResolvedValue({ id: 'channel-playback-1' }),
      hangup: jest.fn().mockResolvedValue(undefined),
    },
    playbacks: {
      stop: jest.fn().mockResolvedValue(undefined),
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

describe('group node handling', () => {
  it('returns default for visual-only group nodes without attempting executor fallback', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const channel = {
      id: 'channel-1',
      play: jest.fn(),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'group-1', type: 'group', label: 'Group', config: {} };

    const result = await executeNode(channel, node, createSession(), createAriClient());

    expect(result).toBe('default');
    expect(channel.play).not.toHaveBeenCalled();
    expect(channel.hangup).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('play_audio executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue('callytics/test-audio');
  });

  it('calls channel.play() with correct media URI when audio_file_id resolves to a filename', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockImplementation(async () => {
        setImmediate(() => {
          ariClient.emit('PlaybackFinished', { playback: { id: 'playback-1' } });
        });
      }),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'node-1', type: 'play_audio', label: 'Play', config: { audio_file_id: 1 } };

    const result = await executeNode(channel, node, session, ariClient);

    expect(channel.play).toHaveBeenCalledWith({ media: 'sound:callytics/test-audio' }, expect.objectContaining({ id: 'playback-1' }));
    expect(result).toBe('default');
  });

  it('resolves after playback event fires', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockImplementation(async () => {
        setImmediate(() => {
          ariClient.emit('PlaybackFinished', { playback: { id: 'playback-1' } });
        });
      }),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'node-1', type: 'play_audio', label: 'Play', config: { audio_file_id: 1 } };

    await expect(executeNode(channel, node, session, ariClient)).resolves.toBe('default');
  });

  it('returns hangup if channel hangs up mid-play', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockImplementation(async () => {
        setImmediate(() => {
          ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
        });
      }),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'node-1', type: 'play_audio', label: 'Play', config: { audio_file_id: 1 } };

    await expect(executeNode(channel, node, session, ariClient)).resolves.toBe('hangup');
  });
});

describe.each([
  {
    suite: 'get_digits',
    type: 'get_digits',
    config: { prompt_audio_file_id: 1, timeout_ms: 5000 },
  },
])('$suite executor', ({ type, config }) => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue('callytics/prompt');
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('starts channel.play(), sets up DTMF listener, resolves digit, and cancels playback on first digit', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const playback = { id: 'playback-1', stop: jest.fn().mockResolvedValue(undefined) };
    (ariClient.Playback as jest.Mock).mockReturnValue(playback);
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'node-1', type, label: 'Digits', config };

    const promise = executeNode(channel, node, session, ariClient);
    await Promise.resolve();
    await Promise.resolve();
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '3' });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBe(type === 'menu' ? 'invalid' : '3');
    expect(channel.play).toHaveBeenCalledWith({ media: 'sound:callytics/prompt' }, playback);
    expect(ariClient.on).toHaveBeenCalledWith('ChannelDtmfReceived', expect.any(Function));
    expect(playback.stop).toHaveBeenCalled();
  });

  it('resolves to timeout when timeout_ms elapses with no input', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const playback = { id: 'playback-1', stop: jest.fn().mockResolvedValue(undefined) };
    (ariClient.Playback as jest.Mock).mockReturnValue(playback);
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'node-1', type, label: 'Digits', config };

    const promise = executeNode(channel, node, session, ariClient);
    await jest.advanceTimersByTimeAsync(5250);
    await expect(promise).resolves.toBe('timeout');
  });

  it('returns hangup and stops playback when the caller hangs up mid-prompt',async() => {
  const session = createSession();
  session.inboundBridge = null;

  const ariClient = createAriClient();
  const playback = { id: 'playback-1',stop: jest.fn().mockResolvedValue(undefined)};
    (ariClient.Playback as jest.Mock).mockReturnValue(playback);

    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    }

    const node: FlowNode = {
      nodeKey: 'node-1',
      type: 'get_digits',
      label: 'Digits',
      config: {prompt_audio_file_id: 1, timeout_ms: 5000},
    };

    const promise = executeNode(channel,node,session,ariClient);
    await Promise.resolve();
    await Promise.resolve();

    ariClient.emit('StasisEnd',{channel: {id:'channel-1'}});
    await flushPromises();

    await expect(promise).resolves.toBe('hangup');

    expect(playback.stop).toHaveBeenCalled();
  });
});

describe('menu retry behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockImplementation(async (_config, idField) => `callytics/${idField}`);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('plays invalid prompt and retries the same menu until a valid digit is pressed', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = {
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
      },
    };

    const promise = executeNode(channel, node, session, ariClient);
    await flushPromises(20);
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '9' });
    await flushPromises(20);
    await jest.advanceTimersByTimeAsync(0);
    await flushPromises(20);
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '1' });
    await flushPromises(20);
    await expect(promise).resolves.toBe('1');

    expect(channel.play).toHaveBeenCalledWith({ media: 'sound:callytics/invalid_prompt_audio_id' }, expect.anything());
    expect(channel.play).toHaveBeenCalledWith({ media: 'sound:callytics/prompt_audio_file_id' }, expect.anything());
    expect(session.variables['menu:1:menu-1:invalid_count']).toBeUndefined();
  });

  it('hangs up after the third timeout and plays the final failure prompt', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = {
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
      },
    };

    const promise = executeNode(channel, node, session, ariClient);
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises();

    await expect(promise).resolves.toBe('hangup');
    expect(channel.play).toHaveBeenCalledWith({ media: 'sound:callytics/final_failure_audio_id' }, expect.anything());
    expect(session.variables['menu:1:menu-1:timeout_count']).toBeUndefined();
  });

  it('hangs up after the third invalid digit and plays the final failure prompt', async () => {
    const session = createSession();
    session.inboundBridge = null;
    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = {
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
      },
    };

    const promise = executeNode(channel, node, session, ariClient);
    await flushPromises(20);
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '9' });
    await flushPromises(20);
    await jest.advanceTimersByTimeAsync(0);
    await flushPromises(20);
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '8' });
    await flushPromises(20);
    await jest.advanceTimersByTimeAsync(0);
    await flushPromises(20);
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '7' });
    await flushPromises(20);

    await expect(promise).resolves.toBe('hangup');
    expect(channel.play).toHaveBeenCalledWith({ media: 'sound:callytics/final_failure_audio_id' }, expect.anything());
    expect(session.variables['menu:1:menu-1:invalid_count']).toBeUndefined();
  });
});

describe('transfer executor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue(null);
    rejectTransferWaiterMock.mockImplementation(() => undefined);
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
    queryMock.mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('calls client.channels.originate() with correct destination and timeout', async () => {
    const ariClient = createAriClient();
    const outboundChannel = { id: 'outbound-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerTransferWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: outboundChannel }),
    );
    const channel = { id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) };
    const node: FlowNode = { nodeKey: 'transfer-1', type: 'transfer', label: 'Transfer', config: { target_type: 'extension', target_value: '2001', timeout_ms: 7000 } };

    const promise = executeNode(channel as any, node, createSession(), ariClient as any);
    await flushPromises(20);

    expect(ariClient.channels.originate).toHaveBeenCalledWith({
      endpoint: 'PJSIP/2001',
      app: 'callytics',
      appArgs: 'transfer-outbound,channel-1',
      callerId: '1000',
      timeout: 7,
    });

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);
    await expect(promise).resolves.toBe('done');
  });

it('resolves pstn target through trunk and dials PJSIP/<number>@<trunk.username>', async () => {
    const ariClient = createAriClient();
    const outboundChannel = { id: 'outbound-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerTransferWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: outboundChannel }),
    );

    const node: FlowNode = {
      nodeKey: 'transfer-2',
      type: 'transfer',
      label: 'Transfer PSTN',
      config: { target_type: 'pstn', target_value: '+18005551234', trunk_id: 7, timeout_ms: 7000 },
    };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await flushPromises(20);

    expect(ariClient.channels.originate).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'PJSIP/+18005551234@trunk-7' }),
    );

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    ariClient.emit('StasisEnd', { channel: { id: 'outbound-1' } });
    await flushPromises(20);
    await expect(promise).resolves.toBe('done');
  });

  it('handles pstn target with missing trunk cleanly by returning hangup', async () => {
    const ariClient = createAriClient();
    registerTransferWaiterMock.mockReturnValue(new Promise(() => {}));

    const node: FlowNode = {
      nodeKey: 'transfer-3',
      type: 'transfer',
      label: 'Transfer PSTN Missing Trunk',
      config: { target_type: 'pstn', target_value: '+18005550000', trunk_id: 999, timeout_ms: 5000, on_no_answer: '' },
    };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises(10);
    await expect(promise).resolves.toBe('hangup');
  });

  it('dials sip_uri target as PJSIP/<target_value>', async () => {
    const ariClient = createAriClient();
    const outboundChannel = { id: 'outbound-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerTransferWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: outboundChannel }),
    );

    const node: FlowNode = {
      nodeKey: 'transfer-4',
      type: 'transfer',
      label: 'Transfer SIP URI',
      config: { target_type: 'sip_uri', target_value: 'sip:john@external.com', timeout_ms: 7000 },
    };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await flushPromises(20);

    expect(ariClient.channels.originate).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'PJSIP/sip:john@external.com' }),
    );

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);
    await expect(promise).resolves.toBe('done');
  });

  it('returns done when the originated channel enters the bridge flow and the channel ends', async () => {
    const ariClient = createAriClient();
    const outboundChannel = { id: 'outbound-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerTransferWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: outboundChannel }),
    );
    const node: FlowNode = { nodeKey: 'transfer-1', type: 'transfer', label: 'Transfer', config: { target_type: 'extension', target_value: '2001', timeout_ms: 7000 } };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await flushPromises(20);
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);

    await expect(promise).resolves.toBe('done');
    expect(ariClient.bridges.create).toHaveBeenCalledWith({ type: 'mixing' });
    expect(ariClient.bridges.addChannel).toHaveBeenNthCalledWith(1, { bridgeId: 'bridge-new-1', channel: 'channel-1' });
    expect(ariClient.bridges.addChannel).toHaveBeenNthCalledWith(2, { bridgeId: 'bridge-new-1', channel: 'outbound-1' });
  });

  it('returns route:on-no-answer when timeout elapses with no answer', async () => {
    const ariClient = createAriClient();
    registerTransferWaiterMock.mockReturnValue(new Promise(() => {}));
    const node: FlowNode = { nodeKey: 'transfer-1', type: 'transfer', label: 'Transfer', config: { target_type: 'extension', target_value: '2001', timeout_ms: 5000, on_no_answer: 'fallback' } };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await flushPromises(10);
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises(10);

    await expect(promise).resolves.toBe('route:fallback');
  });

  it('returns route:on-no-answer when originated channel waiter rejects before bridgeing', async () => {
    const ariClient = createAriClient();
    registerTransferWaiterMock.mockReturnValue(Promise.reject(new Error('hangup')));
    const node: FlowNode = { nodeKey: 'transfer-1', type: 'transfer', label: 'Transfer', config: { target_type: 'extension', target_value: '2001', timeout_ms: 5000, on_no_answer: 'fallback' } };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await flushPromises(10);
    await expect(promise).resolves.toBe('route:fallback');
  });

  it('ends the transfer bridge flow cleanly if the inbound channel hangs up mid-transfer', async () => {
    const ariClient = createAriClient();
    const outboundChannel = { id: 'outbound-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerTransferWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: outboundChannel }),
    );
    const node: FlowNode = { nodeKey: 'transfer-1', type: 'transfer', label: 'Transfer', config: { target_type: 'extension', target_value: '2001', timeout_ms: 7000 } };

    const promise = executeNode({ id: 'channel-1', play: jest.fn(), hangup: jest.fn().mockResolvedValue(undefined) } as any, node, createSession(), ariClient as any);
    await flushPromises(20);
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);

    await expect(promise).resolves.toBe('done');
    expect(ariClient.bridges.destroy).toHaveBeenCalledWith({ bridgeId: 'bridge-new-1' });
  });
});

describe('hunt executor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('dials the first destination on entry', async () => {
    const ariClient = createAriClient();
    const outboundChannel = { id: 'hunt-1', hangup: jest.fn().mockResolvedValue(undefined) };
    registerHuntWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: outboundChannel }),
    );
    resolveAudioMediaPathMock.mockResolvedValue(null);
    const node: FlowNode = { nodeKey: 'hunt-1', type: 'hunt', label: 'Hunt', config: { destinations: [{ target_type: 'extension', target_value: '2001' }, { target_type: 'extension', target_value: '2002' }], attempt_timeout_ms: 5000, total_timeout_ms: 10000 } };

    const promise = executeHunt({ id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) }, node, createSession(), ariClient as any);
    await flushPromises();
    expect(ariClient.channels.originate).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'PJSIP/2001' }));
    ariClient.emit('ChannelStateChange', { channel: { id: 'hunt-1', state: 'Up' } });
    await flushPromises();
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();
    await expect(promise).resolves.toBe('done');
  });

  it('moves to the next destination when the first destination does not answer within timeout', async () => {
    const ariClient = createAriClient();
    const second = { id: 'hunt-2', hangup: jest.fn().mockResolvedValue(undefined) };
    let resolveSecondWaiter:
      | ((result: { answered: true; channel: { id: string; hangup: () => Promise<void> } }) => void)
      | null = null;
    const secondWaiter = new Promise<{
      answered: true;
      channel: { id: string; hangup: () => Promise<void> };
    }>((resolve) => {
      resolveSecondWaiter = resolve;
    });
    registerHuntWaiterMock
      .mockImplementationOnce((token: string) => new Promise((resolve) => {
        huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
      }))
      .mockReturnValueOnce(secondWaiter);
    (ariClient.channels.originate as jest.Mock)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        // Simulate outbound leg entering Stasis on the second destination.
        resolveSecondWaiter?.({ answered: true, channel: second });
      });
    resolveAudioMediaPathMock.mockResolvedValue(null);
    const node: FlowNode = { nodeKey: 'hunt-1', type: 'hunt', label: 'Hunt', config: { destinations: [{ target_type: 'extension', target_value: '2001' }, { target_type: 'extension', target_value: '2002' }], attempt_timeout_ms: 5000, total_timeout_ms: 15000 } };

    const promise = executeHunt({ id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) }, node, createSession(), ariClient as any);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(5000);
    await flushPromises();
    ariClient.emit('ChannelStateChange', { channel: { id: 'hunt-2', state: 'Up' } });
    await flushPromises();
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();
    await expect(promise).resolves.toBe('done');

    expect(ariClient.channels.originate).toHaveBeenNthCalledWith(1, expect.objectContaining({ endpoint: 'PJSIP/2001' }));
    expect(ariClient.channels.originate).toHaveBeenNthCalledWith(2, expect.objectContaining({ endpoint: 'PJSIP/2002' }));
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({ bridgeId: 'bridge-inbound-1', channel: 'hunt-2' });
  });

  it('resolves to done when any destination answers', async () => {
    const ariClient = createAriClient();
    const answered = { id: 'hunt-2', hangup: jest.fn().mockResolvedValue(undefined) };
    registerHuntWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: answered }),
    );
    resolveAudioMediaPathMock.mockResolvedValue(null);
    const node: FlowNode = { nodeKey: 'hunt-1', type: 'hunt', label: 'Hunt', config: { destinations: [{ target_type: 'extension', target_value: '2002' }], attempt_timeout_ms: 5000, total_timeout_ms: 15000 } };

    const promise = executeHunt({ id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) }, node, createSession(), ariClient as any);
    await flushPromises();
    ariClient.emit('ChannelStateChange', { channel: { id: 'hunt-2', state: 'Up' } });
    await flushPromises();
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();

    await expect(promise).resolves.toBe('done');
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({ bridgeId: 'bridge-inbound-1', channel: 'hunt-2' });
  });

  it('resolves to route:on-no-answer when all destinations fail to answer', async () => {
    const ariClient = createAriClient();
    registerHuntWaiterMock
      .mockImplementationOnce((token: string) => new Promise((resolve) => {
        huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
      }))
      .mockImplementationOnce((token: string) => new Promise((resolve) => {
        huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
      }));
    (ariClient.channels.originate as jest.Mock)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => undefined);
    resolveAudioMediaPathMock.mockResolvedValue(null);
    const node: FlowNode = { nodeKey: 'hunt-1', type: 'hunt', label: 'Hunt', config: { destinations: [{ target_type: 'extension', target_value: '2001' }, { target_type: 'extension', target_value: '2002' }], attempt_timeout_ms: 3000, total_timeout_ms: 6000, on_no_answer: 'fallback' } };

    const promise = executeHunt({ id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) }, node, createSession(), ariClient as any);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(3000);
    await flushPromises();
    await jest.advanceTimersByTimeAsync(3000);

    await expect(promise).resolves.toBe('route:fallback');
  }, 15000);

  it('plays hold audio on the bridge while dialing and stops it when a destination answers', async () => {
    const ariClient = createAriClient();
    const holdPlayback = { id: 'hold-playback', stop: jest.fn().mockResolvedValue(undefined) };
    (ariClient.Playback as jest.Mock)
      .mockReturnValueOnce(holdPlayback)
      .mockReturnValue({ id: 'playback-2', stop: jest.fn().mockResolvedValue(undefined) });
    const answered = { id: 'hunt-2', hangup: jest.fn().mockResolvedValue(undefined) };
    registerHuntWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: answered }),
    );
    resolveAudioMediaPathMock.mockImplementation(async (_config, idField) => {
      if (idField === 'hold_audio_file_id') {
        return 'callytics/hold';
      }
      return null;
    });
    const node: FlowNode = { nodeKey: 'hunt-1', type: 'hunt', label: 'Hunt', config: { destinations: [{ target_type: 'extension', target_value: '2002' }], attempt_timeout_ms: 5000, total_timeout_ms: 15000, hold_audio_file_path: 'hold' } };

    const promise = executeHunt({ id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) }, node, createSession(), ariClient as any);
    await flushPromises();
    expect(ariClient.bridges.play).toHaveBeenCalledWith(expect.objectContaining({ bridgeId: 'bridge-inbound-1', media: 'sound:callytics/hold' }));
    ariClient.emit('ChannelStateChange', { channel: { id: 'hunt-2', state: 'Up' } });
    await flushPromises();
    await jest.advanceTimersByTimeAsync(250);
    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();

    await expect(promise).resolves.toBe('done');
    expect(holdPlayback.stop).toHaveBeenCalled();
  });

  it('returns hangup when inbound channel ends while hunt is still dialing', async () => {
    const ariClient = createAriClient();
    registerHuntWaiterMock.mockImplementation((token: string) => new Promise((resolve) => {
      huntWaiters.set(token, resolve as (result: { answered: false; reason: 'failed' | 'destroyed' }) => void);
    }));
    resolveAudioMediaPathMock.mockResolvedValue(null);
    const node: FlowNode = {
      nodeKey: 'hunt-1',
      type: 'hunt',
      label: 'Hunt',
      config: { destinations: [{ target_type: 'extension', target_value: '2001' }], attempt_timeout_ms: 3000, total_timeout_ms: 3500, on_no_answer: 'fallback' },
    };

    const promise = executeHunt(
      { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) },
      node,
      createSession(),
      ariClient as any,
    );

    await flushPromises();
    expect(ariClient.channels.originate).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'PJSIP/2001' }),
    );

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises();

    await jest.advanceTimersByTimeAsync(4000);
    await flushPromises();

    await expect(promise).resolves.toBe('hangup');
    expect(ariClient.channels.originate).toHaveBeenCalledTimes(1);
  });
});

describe('hangup executor', () => {
  it('calls channel.hangup() and resolves to done', async () => {
    const channel = {
      id: 'channel-1',
      play: jest.fn(),
      hangup: jest.fn().mockResolvedValue(undefined),
    };
    const node: FlowNode = { nodeKey: 'node-1', type: 'hangup', label: 'Hangup', config: {} };

    const result = await executeNode(channel, node, createSession(), {});

    expect(channel.hangup).toHaveBeenCalledTimes(1);
    expect(result).toBe('done');
  });
});
