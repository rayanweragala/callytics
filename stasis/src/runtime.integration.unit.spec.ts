jest.mock('./db', () => ({
  query: jest.fn(),
}));

jest.mock('./audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));

jest.mock('./telemetry', () => ({
  publishNodeTelemetry: jest.fn().mockResolvedValue(undefined),
  publishCallEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./huntManager', () => ({
  registerHuntWaiter: jest.fn(),
}));

import { query } from './db';
import { resolveAudioMediaPath } from './audioResolver';
import { registerHuntWaiter } from './huntManager';
import { runFlow } from './runtime';
import type { CallSession } from './callSession';

const queryMock = query as jest.MockedFunction<typeof query>;
const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;
const registerHuntWaiterMock = registerHuntWaiter as jest.MockedFunction<typeof registerHuntWaiter>;

function createSession(): CallSession {
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '1000',
    currentNodeKey: 'start',
    variables: {},
    startedAt: new Date(),
    recording: null,
    inboundBridge: { id: 'bridge-inbound-1' },
    flow: {
      id: 19,
      name: 'Root Flow',
      versionId: 101,
      nodes: [
        { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
        {
          nodeKey: 'menu-1',
          type: 'menu',
          label: 'Main Menu',
          config: {
            branches: ['1', '2'],
            timeout_ms: 5000,
            prompt_audio_file_id: '2',
            submenu_branch_targets: { '2': 'sub-play-2' },
          },
        },
        { nodeKey: 'root-hangup', type: 'hangup', label: 'Hangup', config: {} },
      ],
      edges: [
        { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
        { sourceNodeKey: 'menu-1', targetNodeKey: 'root-hangup', branchKey: 'complete', condition: 'complete' },
      ],
    },
  };
}

function createAriClient() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  let playbackCounter = 0;

  const emit = (event: string, payload: any) => {
    for (const listener of Array.from(listeners.get(event) || [])) {
      listener(payload);
    }
  };

  return {
    Playback: jest.fn(() => ({
      id: `playback-${++playbackCounter}`,
      stop: jest.fn().mockResolvedValue(undefined),
    })),
    channels: {
      originate: jest.fn().mockResolvedValue(undefined),
    },
    bridges: {
      addChannel: jest.fn().mockResolvedValue(undefined),
      play: jest.fn().mockImplementation(async ({ playbackId }: { playbackId?: string }) => {
        if (!playbackId) return;
        setTimeout(() => emit('PlaybackFinished', { playback: { id: playbackId } }), 0);
      }),
    },
    on: jest.fn((event: string, listener: (event: any) => void) => {
      const bucket = listeners.get(event) || new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    }),
    removeListener: jest.fn((event: string, listener: (event: any) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit,
  };
}

async function flushPromises(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe('runtime integration — menu to submenu hunt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    resolveAudioMediaPathMock.mockImplementation(async (_config, idField) => {
      if (idField === 'prompt_audio_file_id') return 'callytics/2';
      if (idField === 'audio_file_id') return 'callytics/4';
      return null;
    });

    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM flow_nodes') && sql.includes('WHERE flow_version_id = $1 AND node_key = $2')) {
        return [{ subflow_id: 222 }];
      }
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Subflow', status: 'published', current_version_id: 333 }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && Number(params?.[0]) === 333) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'sub-play-2', type: 'play_audio', label: 'Sub Play', config_json: { audio_file_id: '4' } },
          {
            node_key: 'hunt-1',
            type: 'hunt',
            label: 'Hunt',
            config_json: {
              strategy: 'sequential',
              destinations: [{ target_type: 'extension', target_value: '2001' }],
              attempt_timeout_ms: 3000,
              total_timeout_ms: 10000,
            },
          },
          { node_key: 'sub-hangup', type: 'hangup', label: 'Sub Hangup', config_json: {} },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && Number(params?.[0]) === 333) {
        return [
          { source_node_key: 'start', target_node_key: 'sub-play-2', branch_key: 'default', condition: null },
          { source_node_key: 'sub-play-2', target_node_key: 'hunt-1', branch_key: 'default', condition: null },
          { source_node_key: 'hunt-1', target_node_key: 'sub-hangup', branch_key: 'done', condition: 'done' },
        ];
      }
      return [];
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('accepts DTMF during menu prompt and bridges already-up hunt leg, then cleans up answered leg on caller end', async () => {
    const ariClient = createAriClient();
    const answeredLeg = { id: 'hunt-leg-1', state: 'Up', hangup: jest.fn().mockResolvedValue(undefined) };
    registerHuntWaiterMock.mockReturnValue(
      Promise.resolve({ answered: true, channel: answeredLeg }),
    );

    const session = createSession();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    const runPromise = runFlow(channel as never, session, ariClient as never);

    await flushPromises(20);
    ariClient.emit('ChannelDtmfReceived', { channel: { id: 'channel-1' }, digit: '2' });
    await flushPromises(20);
    await jest.advanceTimersByTimeAsync(0);
    await flushPromises(20);

    expect(ariClient.channels.originate).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'PJSIP/2001' }),
    );
    expect(ariClient.bridges.addChannel).toHaveBeenCalledWith({
      bridgeId: 'bridge-inbound-1',
      channel: 'hunt-leg-1',
    });

    ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
    await flushPromises(20);

    await expect(runPromise).resolves.toEqual({status : 'completed'})
    expect(answeredLeg.hangup).toHaveBeenCalled();
    expect(channel.hangup).toHaveBeenCalled();
  });
});
