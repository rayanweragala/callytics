import { createHmac } from 'crypto';
import { stasisLogger } from "../logger";
import { resolveAudioMediaPath } from '../audioResolver';
import { CallSession } from '../callSession';
import { query } from '../db';
import { FlowNode } from '../flowLoader';

interface RecordingFinishedEvent {
  recording?: {
    name?: string;
    duration?: number;
  };
  channel?: {
    id?: string;
  };
}

interface VoicemailConfig {
  mailbox_name?: string;
  max_duration_seconds?: number;
  start_audio_id?: number | null;
  end_audio_id?: number | null;
  send_to_webhook?: boolean;
  webhook_url?: string;
  webhook_secret?: string;
}

async function waitForPlaybackFinished(
  ariClient: unknown,
  playbackId: string,
  channelId: string,
): Promise<void> {
  const client = ariClient as {
    on: (event: string, listener: (event: { playback?: { id?: string }; channel?: { id?: string } }) => void) => void;
    removeListener: (event: string, listener: (event: { playback?: { id?: string }; channel?: { id?: string } }) => void) => void;
  };

  return new Promise((resolve, reject) => {
    const onFinished = (event: { playback?: { id?: string } }) => {
      if (event.playback?.id === playbackId) {
        cleanup();
        resolve();
      }
    };

    const onHangup = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id === channelId) {
        cleanup();
        reject(new Error('hangup'));
      }
    };

    const cleanup = () => {
      client.removeListener('PlaybackFinished', onFinished);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
    };

    client.on('PlaybackFinished', onFinished);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);
  });
}

async function playPromptIfConfigured(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  node: FlowNode,
  ariClient: unknown,
): Promise<void> {
  const promptPath = await resolveAudioMediaPath(node.config, 'start_audio_id', 'start_audio_path');
  if (!promptPath) {
    return;
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  await channel.play({ media: 'sound:' + promptPath }, playback);
  await waitForPlaybackFinished(ariClient, playback.id, channel.id);
}

async function playOutroIfConfigured(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  node: FlowNode,
  ariClient: unknown,
): Promise<void> {
  const outroPath = await resolveAudioMediaPath(node.config, 'end_audio_id', 'end_audio_path');
  if (!outroPath) {
    return;
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  await channel.play({ media: 'sound:' + outroPath }, playback);
  await waitForPlaybackFinished(ariClient, playback.id, channel.id);
}

function waitForRecordingFinished(
  ariClient: unknown,
  recordingName: string,
  channelId: string,
): Promise<number | null> {
  const client = ariClient as {
    on: (event: string, listener: (event: RecordingFinishedEvent) => void) => void;
    removeListener: (event: string, listener: (event: RecordingFinishedEvent) => void) => void;
  };

  return new Promise((resolve, reject) => {
    const onFinished = (event: RecordingFinishedEvent) => {
      if (event.recording?.name !== recordingName) {
        return;
      }
      cleanup();
      const duration = Number(event.recording?.duration ?? NaN);
      resolve(Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null);
    };

    const onHangup = (event: RecordingFinishedEvent) => {
      if (event.channel?.id === channelId) {
        cleanup();
        reject(new Error('hangup'));
      }
    };

    const cleanup = () => {
      client.removeListener('RecordingFinished', onFinished);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
    };

    client.on('RecordingFinished', onFinished);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);
  });
}

async function resolveCallLogId(callUuid: string): Promise<number | null> {
  const rows = await query(
    `
      SELECT id
      FROM call_logs
      WHERE call_uuid = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [callUuid],
  );

  const id = Number(rows[0]?.id || 0);
  return id > 0 ? id : null;
}

async function persistVoicemailRecording(
  session: CallSession,
  channelId: string,
  recordingName: string,
  startedAt: Date,
  durationSeconds: number | null,
): Promise<void> {
  const callLogId = await resolveCallLogId(session.callUuid);
  const endedAt = new Date();
  const fileName = `${recordingName}.ulaw`;
  const filePath = `/var/spool/asterisk/recording/${fileName}`;

  await query(
    `
      INSERT INTO call_recordings (
        call_id,
        call_log_id,
        channel_id,
        flow_id,
        recording_type,
        file_name,
        file_path,
        format,
        duration_seconds,
        started_at,
        ended_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      session.callUuid,
      callLogId,
      channelId,
      session.flow.id,
      'voicemail',
      fileName,
      filePath,
      'ulaw',
      durationSeconds,
      startedAt.toISOString(),
      endedAt.toISOString(),
    ],
  );
}

function fireVoicemailWebhookAsync(
  config: VoicemailConfig,
  session: CallSession,
  node: FlowNode,
  payload: {
    recording_file_path: string;
    recording_duration_seconds: number;
  },
): void {
  const url = String(config.webhook_url || '').trim();
  if (!url) {
    return;
  }

  const secret = String(config.webhook_secret || '').trim();
  const body = {
    call_uuid: session.callUuid,
    channel_id: session.channelId,
    caller_number: session.callerNumber,
    flow_id: session.flow.id,
    flow_name: session.flow.name,
    node_key: node.nodeKey,
    node_label: node.label,
    mailbox_name: String(config.mailbox_name || 'main').trim() || 'main',
    timestamp: new Date().toISOString(),
    variables: { ...session.variables },
    ...payload,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (secret) {
    headers['X-Voicemail-Signature'] = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  }

  void (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      stasisLogger.log(`[voicemail] webhook fired url=${url} status=${response.status} call=${session.callUuid}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stasisLogger.warn(`[voicemail] webhook failed url=${url} err=${message} call=${session.callUuid}`);
    }
  })();
}

export async function executeVoicemail(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<'done'> {
  const config = (node.config || {}) as VoicemailConfig;
  const maxDurationSeconds = Math.max(1, Number(config.max_duration_seconds || 60));
  const mailboxName = String(config.mailbox_name || 'main').trim() || 'main';
  const recordingName = `voicemail-${session.callUuid}-${Date.now()}`;
  const startedAt = new Date();

  await playPromptIfConfigured(channel, node, ariClient);

  const client = ariClient as {
    channels: {
      record: (params: {
        channelId: string;
        name: string;
        format: string;
        maxDurationSeconds: number;
        beep: boolean;
        ifExists: 'overwrite' | 'append' | 'fail';
      }) => Promise<unknown>;
    };
  };

  await client.channels.record({
    channelId: channel.id,
    name: recordingName,
    format: 'ulaw',
    maxDurationSeconds,
    beep: true,
    ifExists: 'overwrite',
  });

  const durationSeconds = await waitForRecordingFinished(ariClient, recordingName, channel.id);
  if (durationSeconds == null || durationSeconds === 0) {
    stasisLogger.log(`[voicemail] skipping save — zero duration call=${session.callUuid}`);
    return 'done';
  }
  
  await persistVoicemailRecording(session, channel.id, recordingName, startedAt, durationSeconds);
  const filePath = `/var/spool/asterisk/recording/${recordingName}.ulaw`;
  fireVoicemailWebhookAsync(config, session, node, {
    recording_file_path: filePath,
    recording_duration_seconds: durationSeconds,
  });
  await playOutroIfConfigured(channel, node, ariClient);
  stasisLogger.log(`[voicemail] mailbox=${mailboxName} call=${session.callUuid} recording=${recordingName}`);
  return 'done';
}
