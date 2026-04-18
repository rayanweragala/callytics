jest.mock('../audioResolver', () => ({
  resolveAudioMediaPath: jest.fn(),
}));

jest.mock('../db', () => ({
  query: jest.fn(),
}));

import { executeVoicemail } from './voicemail.executor';
import { resolveAudioMediaPath } from '../audioResolver';
import { query } from '../db';
import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';

const resolveAudioMediaPathMock = resolveAudioMediaPath as jest.MockedFunction<typeof resolveAudioMediaPath>;
const queryMock = query as jest.MockedFunction<typeof query>;

function createSession(): CallSession {
  return {
    callUuid: 'call-voicemail-1',
    channelId: 'channel-1',
    callerNumber: '94770000000',
    currentNodeKey: 'voicemail_1',
    variables: {},
    startedAt: new Date(),
    recording: null,
    inboundBridge: null,
    flow: {
      id: 55,
      name: 'Dispatch',
      versionId: 90,
      nodes: [],
      edges: [],
    },
  };
}

function createAriClient() {
  const listeners = new Map<string, Set<(event: any) => void>>();

  const on = (event: string, listener: (event: any) => void) => {
    const bucket = listeners.get(event) || new Set();
    bucket.add(listener);
    listeners.set(event, bucket);
  };

  const removeListener = (event: string, listener: (event: any) => void) => {
    listeners.get(event)?.delete(listener);
  };

  const emit = (event: string, payload: any) => {
    for (const listener of Array.from(listeners.get(event) || [])) {
      listener(payload);
    }
  };

  return {
    Playback: jest.fn(() => ({ id: 'playback-1' })),
    channels: {
      record: jest.fn().mockImplementation(async ({ name }: { name: string }) => {
        setImmediate(() => {
          emit('RecordingFinished', {
            recording: { name, duration: 14 },
            channel: { id: 'channel-1' },
          });
        });
      }),
    },
    on: jest.fn(on),
    removeListener: jest.fn(removeListener),
    emit,
  };
}

describe('voicemail.executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records voicemail and persists call_recordings row with recording_type=voicemail', async () => {
    resolveAudioMediaPathMock.mockResolvedValue('callytics/voicemail-prompt');
    queryMock
      .mockResolvedValueOnce([{ id: 777 }])
      .mockResolvedValueOnce([]);

    const ariClient = createAriClient();
    const channel = {
      id: 'channel-1',
      play: jest.fn().mockImplementation(async (_opts, playback: { id: string }) => {
        setImmediate(() => {
          ariClient.emit('PlaybackFinished', { playback: { id: playback.id } });
        });
      }),
    };

    const node: FlowNode = {
      nodeKey: 'voicemail_1',
      type: 'voicemail',
      label: 'Leave Voicemail',
      config: {
        mailbox_name: 'dispatch',
        max_duration_seconds: 60,
        prompt_audio_file_id: 5,
      },
    };

    await expect(executeVoicemail(channel as never, node, createSession(), ariClient)).resolves.toBe('done');

    expect(channel.play).toHaveBeenCalledWith(
      { media: 'sound:callytics/voicemail-prompt' },
      expect.objectContaining({ id: 'playback-1' }),
    );
    expect(ariClient.channels.record).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        format: 'ulaw',
        beep: true,
        ifExists: 'overwrite',
        maxDurationSeconds: 60,
      }),
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('SELECT id'),
      ['call-voicemail-1'],
    );
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO call_recordings'),
      expect.arrayContaining([
        'call-voicemail-1',
        777,
        'channel-1',
        55,
        'voicemail',
      ]),
    );
  });

  it('test 1 — recording starts only after prompt playback finishes', async () => {
    resolveAudioMediaPathMock.mockResolvedValue('callytics/voicemail-prompt');
    queryMock
      .mockResolvedValueOnce([{ id: 777 }])
      .mockResolvedValueOnce([]);

    const callOrder: string[] = [];
    const ariClient = createAriClient();

    const channel = {
      id: 'channel-1',
      play: jest.fn().mockImplementation(async (_opts: unknown, playback: { id: string }) => {
        callOrder.push('prompt_started');
        setImmediate(() => {
          callOrder.push('prompt_finished');
          ariClient.emit('PlaybackFinished', { playback: { id: playback.id } });
        });
      }),
    };

    (ariClient.channels.record as jest.Mock).mockImplementation(
      async ({ name }: { name: string }) => {
        callOrder.push('recording_started');
        setImmediate(() => {
          ariClient.emit('RecordingFinished', {
            recording: { name, duration: 10 },
            channel: { id: 'channel-1' },
          });
        });
      },
    );

    await executeVoicemail(channel as never, {
      nodeKey: 'voicemail_1',
      type: 'voicemail',
      label: 'Leave Voicemail',
      config: { mailbox_name: 'main', max_duration_seconds: 60, prompt_audio_file_id: 5 },
    }, createSession(), ariClient);

    expect(callOrder).toEqual(['prompt_started', 'prompt_finished', 'recording_started']);
  });

  it('test 2 — caller hangs up mid-recording, no DB row saved for empty voicemail', async () => {
    resolveAudioMediaPathMock.mockResolvedValue(null);

    const ariClient = createAriClient();

    (ariClient.channels.record as jest.Mock).mockImplementation(
      async (_params: unknown) => {
        // simulate caller pressing a digit (hangup) before recording finishes
        setImmediate(() => {
          ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } });
        });
      },
    );

    const channel = {
      id: 'channel-1',
      play: jest.fn(),
    };

    const node = {
      nodeKey: 'voicemail_1',
      type: 'voicemail',
      label: 'Leave Voicemail',
      config: { mailbox_name: 'main', max_duration_seconds: 60, prompt_audio_file_id: null },
    };

    await expect(
      executeVoicemail(channel as never, node, createSession(), ariClient),
    ).rejects.toThrow('hangup');

    // DB must not be written — no partial voicemail row
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('test 3 — zero duration recording is not saved to DB', async () => {
    resolveAudioMediaPathMock.mockResolvedValue(null);

    const ariClient = createAriClient();

    (ariClient.channels.record as jest.Mock).mockImplementation(
      async ({ name }: { name: string }) => {
        setImmediate(() => {
          ariClient.emit('RecordingFinished', {
            recording: { name, duration: 0 },
            channel: { id: 'channel-1' },
          });
        });
      },
    );

    const channel = { id: 'channel-1', play: jest.fn() };
    const node = {
      nodeKey: 'voicemail_1',
      type: 'voicemail',
      label: 'Leave Voicemail',
      config: { mailbox_name: 'main', max_duration_seconds: 60, prompt_audio_file_id: null },
    };

    await executeVoicemail(channel as never, node, createSession(), ariClient);

    // query should never be called — nothing to save
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('test 4 — saved recording file contains only voicemail audio, not the prompt', async () => {
    resolveAudioMediaPathMock.mockResolvedValue('callytics/busy-prompt');
    queryMock
      .mockResolvedValueOnce([{ id: 777 }])
      .mockResolvedValueOnce([]);

    const ariClient = createAriClient();
    let capturedRecordingName = '';

    (ariClient.channels.record as jest.Mock).mockImplementation(
      async ({ name }: { name: string }) => {
        capturedRecordingName = name;
        setImmediate(() => {
          ariClient.emit('RecordingFinished', {
            recording: { name, duration: 15 },
            channel: { id: 'channel-1' },
          });
        });
      },
    );

    const channel = {
      id: 'channel-1',
      play: jest.fn().mockImplementation(async (_opts: unknown, playback: { id: string }) => {
        setImmediate(() => {
          ariClient.emit('PlaybackFinished', { playback: { id: playback.id } });
        });
      }),
    };

    const node = {
      nodeKey: 'voicemail_1',
      type: 'voicemail',
      label: 'Leave Voicemail',
      config: { mailbox_name: 'dispatch', max_duration_seconds: 60, prompt_audio_file_id: 5 },
    };

    await executeVoicemail(channel as never, node, createSession(), ariClient);

    // The recording name must be the voicemail recording only — starts with 'voicemail-'
    expect(capturedRecordingName).toMatch(/^voicemail-/);

    // The INSERT must save the voicemail file path, not the prompt path
    const insertCall = queryMock.mock.calls[1];
    const savedFilePath = insertCall[1][6] as string; // file_path is index 6
    expect(savedFilePath).toContain(capturedRecordingName);
    expect(savedFilePath).not.toContain('busy-prompt');
    expect(savedFilePath).not.toContain('callytics');
  });

});