jest.mock('./nodes', () => ({
  executeNode: jest.fn(),
}));

jest.mock('./db', () => ({
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('./telemetry', () => ({
  publishCallEvent: jest.fn().mockResolvedValue(undefined),
  publishNodeTelemetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./executors/webhook.executor', () => ({
  fireWebhookAsync: jest.fn(),
}));

import { EventEmitter } from 'events';
import { executeNode } from './nodes';
import { publishCallEvent } from './telemetry';
import { runFlow } from './runtime';
import { createSession } from './callSession';
import { waitForPlaybackFinished } from './lib/playback';
import type { Flow } from './flowLoader';

const executeNodeMock = executeNode as jest.MockedFunction<typeof executeNode>;
const publishCallEventMock = publishCallEvent as jest.MockedFunction<typeof publishCallEvent>;

const flow: Flow = {
  id: 1,
  name: 'Hangup flow',
  versionId: 1,
  nodes: [
    { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
    { nodeKey: 'play-1', type: 'play_audio', label: 'Play', config: {} },
    { nodeKey: 'hunt-1', type: 'hunt', label: 'Hunt', config: {} },
  ],
  edges: [
    { sourceNodeKey: 'start', targetNodeKey: 'play-1', branchKey: 'default', condition: null },
    { sourceNodeKey: 'play-1', targetNodeKey: 'hunt-1', branchKey: 'default', condition: null },
  ],
} as Flow;

describe('flow execution after the caller hangs up', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not run the next node when the caller left during a playback', async () => {
    const session = createSession('channel-1', '1000', flow, 'start');
    const channel = { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) };

    executeNodeMock.mockImplementation(async (_channel, node) => {
      if (node.nodeKey === 'play-1') {
        // The caller hangs up during playback: the playback wait rejects with "hangup".
        session.callerGone = true;
        throw new Error('hangup');
      }
      return 'default';
    });

    const result = await runFlow(channel as never, session, {});

    const executedNodes = executeNodeMock.mock.calls.map((call) => call[1].nodeKey);
    expect(executedNodes).toEqual(['start', 'play-1']);
    expect(result.status).toBe('completed');
    expect(publishCallEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ended' }));
    expect(publishCallEventMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'failed' }));
  });

  it('does not start a flow node when the caller is already gone', async () => {
    const session = createSession('channel-1', '1000', flow, 'start');
    session.callerGone = true;
    const channel = { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) };

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).not.toHaveBeenCalled();
  });

  it('still reports a real node error as a failed flow', async () => {
    const session = createSession('channel-1', '1000', flow, 'start');
    const channel = { id: 'channel-1', hangup: jest.fn().mockResolvedValue(undefined) };
    executeNodeMock.mockImplementation(async (_channel, node) => {
      if (node.nodeKey === 'play-1') {
        throw new Error('audio file missing');
      }
      return 'default';
    });

    const result = await runFlow(channel as never, session, {});

    expect(result.status).toBe('failed');
  });
});

describe('waitForPlaybackFinished', () => {
  function createClient(options: { channelAlive: boolean }) {
    const emitter = new EventEmitter();
    return {
      emitter,
      client: {
        on: (event: string, listener: (payload: unknown) => void) => void emitter.on(event, listener),
        removeListener: (event: string, listener: (payload: unknown) => void) =>
          void emitter.removeListener(event, listener),
        channels: {
          get: jest.fn(async () => {
            if (!options.channelAlive) {
              throw new Error('Channel not found');
            }
            return {};
          }),
        },
      },
    };
  }

  it('resolves when the playback is done', async () => {
    const { client, emitter } = createClient({ channelAlive: true });
    const pending = waitForPlaybackFinished(client, 'pb-1', 'ch-1');
    emitter.emit('PlaybackFinished', { playback: { id: 'pb-1', state: 'done' } });
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects with hangup when the playback failed because the channel is gone', async () => {
    const { client, emitter } = createClient({ channelAlive: false });
    const pending = waitForPlaybackFinished(client, 'pb-1', 'ch-1');
    emitter.emit('PlaybackFinished', { playback: { id: 'pb-1', state: 'failed' } });
    await expect(pending).rejects.toThrow('hangup');
  });

  it('continues when the playback failed on a channel that is still up', async () => {
    const { client, emitter } = createClient({ channelAlive: true });
    const pending = waitForPlaybackFinished(client, 'pb-1', 'ch-1');
    emitter.emit('PlaybackFinished', {
      playback: { id: 'pb-1', state: 'failed', media_uri: 'sound:missing' },
    });
    await expect(pending).resolves.toBeUndefined();
  });

  it.each(['StasisEnd', 'ChannelDestroyed', 'ChannelHangupRequest'])('rejects with hangup on %s', async (eventName) => {
    const { client, emitter } = createClient({ channelAlive: true });
    const pending = waitForPlaybackFinished(client, 'pb-1', 'ch-1');
    emitter.emit(eventName, { channel: { id: 'ch-1' } });
    await expect(pending).rejects.toThrow('hangup');
    expect(emitter.listenerCount('PlaybackFinished')).toBe(0);
  });

  it('ignores events of other channels and playbacks', async () => {
    const { client, emitter } = createClient({ channelAlive: true });
    const pending = waitForPlaybackFinished(client, 'pb-1', 'ch-1');
    emitter.emit('ChannelDestroyed', { channel: { id: 'other' } });
    emitter.emit('PlaybackFinished', { playback: { id: 'other', state: 'failed' } });
    emitter.emit('PlaybackFinished', { playback: { id: 'pb-1', state: 'done' } });
    await expect(pending).resolves.toBeUndefined();
  });
});
