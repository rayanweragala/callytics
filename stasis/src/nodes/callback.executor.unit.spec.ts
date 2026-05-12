jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn().mockResolvedValue(null),
}));

jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../redis', () => ({
  publish: jest.fn().mockResolvedValue(undefined),
}));

import { executeCallbackNode } from './callback.executor';
import { resolveAudioMediaPath } from '../audioResolver';
import { query } from '../db';
import { publish } from '../redis';
import type { CallSession } from '../callSession';
import type { FlowNode } from '../flowLoader';

const queryMock = query as jest.MockedFunction<typeof query>;
const publishMock = publish as jest.MockedFunction<typeof publish>;
const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;

function createSession(): CallSession {
  const startedAt = new Date();
  return {
    callUuid: '1777089800.18',
    channelId: '1777089800.18',
    callerNumber: '2001',
    currentNodeKey: 'callback-1',
    variables: {},
    webhookPayload: {},
    call_started_at: startedAt.toISOString(),
    call_ended_at: null,
    startedAt,
    recording: null,
    inboundBridge: null,
    flow: {
      id: 4903,
      name: 'callback_test_v1',
      versionId: 24,
      nodes: [],
      edges: [],
    },
  };
}

function createAriClient() {
  return {
    on: jest.fn(),
    removeListener: jest.fn(),
    Playback: jest.fn(() => ({ id: 'playback-1' })),
  };
}

async function flushPromises(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('callback executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveAudioMediaPathMock.mockResolvedValue(null);
  });

  it('publishes callback:created with resolved operator id when extension destination is numeric id text', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM operators o')) {
        return [{ id: 2 }];
      }
      if (sql.includes('FROM call_logs')) {
        return [{ id: 126 }];
      }
      return [];
    });

    const channel = {
      id: '1777089800.18',
      caller: { number: '2001' },
      play: jest.fn(),
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    const node: FlowNode = {
      nodeKey: 'callback-1',
      type: 'callback',
      label: 'Callback',
      config: {
        number_source: 'ani',
        destination_type: 'extension',
        destination_value: '1234',
        operator_id: null,
        confirmation_audio_id: null,
      },
    };

    const session = createSession();
    const result = await executeCallbackNode(
      channel,
      node,
      session,
      createAriClient() as unknown,
    );

    expect(result).toBe('done');
    expect(publishMock).toHaveBeenCalledWith(
      'callback:created',
      expect.objectContaining({
        flowId: 4903,
        callLogId: 126,
        customerNumber: '2001',
        operatorId: 2,
      }),
    );
    expect(session.variables.callback_number).toBeUndefined();
    expect(session.webhookPayload).toEqual({
      callback: { number: '2001', source: 'ani' },
      outcome: { status: 'completed' },
    });
  });

  it('keeps collected dtmf digits on timeout instead of publishing empty number', async () => {
    jest.useFakeTimers();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM operators o')) return [];
      if (sql.includes('FROM call_logs')) return [{ id: 134 }];
      return [];
    });

    const listeners = new Map<string, Set<(event: any) => void>>();
    const ariClient = {
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
      Playback: jest.fn(() => ({ id: 'playback-1' })),
    };

    const channel = {
      id: '1777094832.44',
      caller: { number: '2001' },
      play: jest.fn(),
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    const node: FlowNode = {
      nodeKey: 'callback-1',
      type: 'callback',
      label: 'Callback',
      config: {
        number_source: 'dtmf',
        dtmf_max_digits: 11,
        destination_type: 'pstn',
        destination_value: '+94781100996',
        destination_trunk_id: 3,
        confirmation_audio_id: null,
      },
    };

    const session = createSession();
    const run = executeCallbackNode(channel, node, session, ariClient as unknown);
    for (let i = 0; i < 20; i += 1) {
      if ((listeners.get('ChannelDtmfReceived')?.size || 0) > 0) break;
      await Promise.resolve();
    }
    const entered = '7766221199';
    for (const digit of entered) {
      ariClient.emit('ChannelDtmfReceived', {
        channel: { id: channel.id },
        digit,
      });
    }

    await jest.advanceTimersByTimeAsync(20_100);
    const result = await run;
    jest.useRealTimers();

    expect(result).toBe('done');
    expect(publishMock).toHaveBeenCalledWith(
      'callback:created',
      expect.objectContaining({
        callLogId: 134,
        customerNumber: '7766221199',
        destinationType: 'pstn',
        destinationValue: '+94781100996',
        destinationTrunkId: 3,
      }),
    );
    expect(session.variables.callback_number).toBe('7766221199');
    expect(session.webhookPayload).toEqual({
      callback: { number: '7766221199', source: 'dtmf' },
      outcome: { status: 'completed' },
    });
  });

  it('uses callback timeout_ms from node config for dtmf collection', async () => {
    jest.useFakeTimers();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM operators o')) return [];
      if (sql.includes('FROM call_logs')) return [{ id: 135 }];
      return [];
    });

    const listeners = new Map<string, Set<(event: any) => void>>();
    const ariClient = {
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
      Playback: jest.fn(() => ({ id: 'playback-1' })),
    };

    const channel = {
      id: '1777095307.50',
      caller: { number: '2001' },
      play: jest.fn(),
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    const node: FlowNode = {
      nodeKey: 'callback-1',
      type: 'callback',
      label: 'Callback',
      config: {
        number_source: 'dtmf',
        dtmf_max_digits: 11,
        timeout_ms: 3000,
        destination_type: 'pstn',
        destination_value: '+94781100996',
        destination_trunk_id: 3,
        confirmation_audio_id: null,
      },
    };

    const session = createSession();
    const run = executeCallbackNode(channel, node, session, ariClient as unknown);
    for (let i = 0; i < 20; i += 1) {
      if ((listeners.get('ChannelDtmfReceived')?.size || 0) > 0) break;
      await Promise.resolve();
    }

    ariClient.emit('ChannelDtmfReceived', {
      channel: { id: channel.id },
      digit: '7',
    });

    await jest.advanceTimersByTimeAsync(2_900);
    expect(publishMock).not.toHaveBeenCalledWith(
      'callback:created',
      expect.objectContaining({
        callLogId: 135,
      }),
    );

    await jest.advanceTimersByTimeAsync(200);
    const result = await run;
    jest.useRealTimers();

    expect(result).toBe('done');
    expect(session.webhookPayload).toEqual({
      callback: { number: '7', source: 'dtmf' },
      outcome: { status: 'completed' },
    });
    expect(publishMock).toHaveBeenCalledWith(
      'callback:created',
      expect.objectContaining({
        callLogId: 135,
        customerNumber: '7',
      }),
    );
  });

  it('stops dtmf prompt audio immediately after first digit', async () => {
    jest.useFakeTimers();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM operators o')) return [];
      if (sql.includes('FROM call_logs')) return [{ id: 136 }];
      return [];
    });
    resolveAudioMediaPathMock.mockImplementation(async (_nodeConfig, audioIdField) => {
      if (audioIdField === 'dtmf_prompt_audio_id') return 'custom/callback_prompt';
      return null;
    });

    const listeners = new Map<string, Set<(event: any) => void>>();
    const playbackStop = jest.fn().mockResolvedValue(undefined);
    const ariClient = {
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
      Playback: jest.fn(() => ({ id: 'playback-1', stop: playbackStop })),
    };

    const channel = {
      id: '1777095400.60',
      caller: { number: '2001' },
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    const node: FlowNode = {
      nodeKey: 'callback-1',
      type: 'callback',
      label: 'Callback',
      config: {
        number_source: 'dtmf',
        dtmf_max_digits: 11,
        timeout_ms: 3000,
        dtmf_prompt_audio_id: 11,
        destination_type: 'pstn',
        destination_value: '+94781100996',
        destination_trunk_id: 3,
        confirmation_audio_id: null,
      },
    };

    const run = executeCallbackNode(channel, node, createSession(), ariClient as unknown);
    for (let i = 0; i < 20; i += 1) {
      if ((listeners.get('ChannelDtmfReceived')?.size || 0) > 0) break;
      await Promise.resolve();
    }

    ariClient.emit('ChannelDtmfReceived', {
      channel: { id: channel.id },
      digit: '9',
    });
    await flushPromises(10);

    expect(playbackStop).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(3_200);
    const result = await run;
    jest.useRealTimers();

    expect(result).toBe('done');
    expect(publishMock).toHaveBeenCalledWith(
      'callback:created',
      expect.objectContaining({
        callLogId: 136,
        customerNumber: '9',
      }),
    );
  });

  it('plays confirmation audio when configured and waits for playback completion before hangup', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM operators o')) return [{ id: 2 }];
      if (sql.includes('FROM call_logs')) return [{ id: 140 }];
      return [];
    });
    resolveAudioMediaPathMock.mockImplementation(async (_nodeConfig, audioIdField) => {
      if (audioIdField === 'confirmation_audio_id') return 'custom/callback_confirmation';
      return null;
    });

    const listeners = new Map<string, Set<(event: any) => void>>();
    const ariClient = {
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
      Playback: jest.fn(() => ({ id: 'playback-confirm-1' })),
    };

    const channel = {
      id: '1777096000.70',
      caller: { number: '2001' },
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    const node: FlowNode = {
      nodeKey: 'callback-1',
      type: 'callback',
      label: 'Callback',
      config: {
        number_source: 'ani',
        destination_type: 'extension',
        destination_value: '1234',
        operator_id: null,
        confirmation_audio_id: 55,
      },
    };

    const run = executeCallbackNode(channel, node, createSession(), ariClient as unknown);
    await flushPromises(10);

    expect(channel.play).toHaveBeenCalledWith(
      { media: 'sound:custom/callback_confirmation' },
      expect.objectContaining({ id: 'playback-confirm-1' }),
    );
    expect(channel.hangup).not.toHaveBeenCalled();

    ariClient.emit('PlaybackFinished', { playback: { id: 'playback-confirm-1' } });
    const result = await run;

    expect(result).toBe('done');
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });
});
