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

interface DtmfEvent {
  channel?: { id?: string };
  digit?: string;
}

interface VoicemailConfig {
  mailbox_name?: string;
  max_duration_seconds?: number;
  start_audio_id?: number | null;
  end_audio_id?: number | null;
}

const VOICEMAIL_RECORDING_FORMAT = 'wav';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

async function detachInboundBridgeForVoicemail(session: CallSession, ariClient: unknown): Promise<void> {
  if (!session.inboundBridge?.id) {
    return;
  }

  const bridgeId = session.inboundBridge.id;
  const client = ariClient as {
    bridges?: {
      destroy?: (params: { bridgeId: string }) => Promise<void>;
    };
  };

  if (!client.bridges?.destroy) {
    stasisLogger.warn(`[voicemail] inbound bridge present but destroy API unavailable bridge=${bridgeId} call=${session.callUuid}`);
    return;
  }

  try {
    await client.bridges.destroy({ bridgeId });
    stasisLogger.log(`[voicemail] detached channel from inbound bridge bridge=${bridgeId} call=${session.callUuid}`);
    session.inboundBridge = null;
  } catch (error) {
    stasisLogger.warn(`[voicemail] failed detaching inbound bridge bridge=${bridgeId} call=${session.callUuid}:`, error);
  }
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
  try {
    await channel.play({ media: 'sound:' + outroPath }, playback);
    await waitForPlaybackFinished(ariClient, playback.id, channel.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Channel not found') || message.includes('hangup')) {
      stasisLogger.log(`[voicemail] skip outro playback call=${channel.id} reason=channel_unavailable`);
      return;
    }
    throw error;
  }
}

async function stopLiveRecording(recordingName: string): Promise<void> {
  const ariUrl = (process.env.ARI_URL || 'http://127.0.0.1:8088').replace(/\/+$/, '');
  const ariUser = process.env.ARI_USER || 'callytics';
  const ariPass = process.env.ARI_PASS || 'callytics';
  const response = await fetch(
    `${ariUrl}/ari/recordings/live/${encodeURIComponent(recordingName)}/stop`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${ariUser}:${ariPass}`).toString('base64')}`,
      },
    },
  );

  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_stop_failed status=${response.status} body=${body}`);
  }
}

function waitForRecordingFinished(
  ariClient: unknown,
  recordingName: string,
  channelId: string,
): Promise<number | null> {
  const client = ariClient as {
    on: (event: string, listener: (event: RecordingFinishedEvent) => void) => void;
    removeListener: (event: string, listener: (event: RecordingFinishedEvent | DtmfEvent) => void) => void;
  };

  return new Promise((resolve, reject) => {
    let stopRequested = false;

    const onFinished = (event: RecordingFinishedEvent) => {
      if (event.recording?.name !== recordingName) {
        return;
      }
      cleanup();
      const duration = Number(event.recording?.duration ?? NaN);
      resolve(Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : null);
    };

    const onDtmf = (event: DtmfEvent) => {
      if (event.channel?.id && event.channel.id !== channelId) {
        return;
      }
      if (String(event.digit || '').trim() !== '#') {
        return;
      }
      if (stopRequested) {
        return;
      }
      stopRequested = true;
      stasisLogger.log(`[voicemail] stop requested via # channel=${channelId} recording=${recordingName}`);
      void stopLiveRecording(recordingName).catch((error) => {
        stasisLogger.warn(`[voicemail] stop via # failed channel=${channelId} recording=${recordingName}:`, error);
      });
    };

    const onHangup = (event: RecordingFinishedEvent) => {
      if (event.channel?.id === channelId) {
        cleanup();
        reject(new Error('hangup'));
      }
    };

    const cleanup = () => {
      client.removeListener('RecordingFinished', onFinished);
      client.removeListener('ChannelDtmfReceived', onDtmf);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
    };

    client.on('RecordingFinished', onFinished);
    client.on('ChannelDtmfReceived', onDtmf as unknown as (event: RecordingFinishedEvent) => void);
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
): Promise<number> {
  const callLogId = await resolveCallLogId(session.callUuid);
  const endedAt = new Date();
  const fileName = `${recordingName}.${VOICEMAIL_RECORDING_FORMAT}`;
  const filePath = `/var/lib/asterisk/recording/${fileName}`;

  const rows = await query(
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
      RETURNING id
    `,
    [
      session.callUuid,
      callLogId,
      channelId,
      session.flow.id,
      'voicemail',
      fileName,
      filePath,
      VOICEMAIL_RECORDING_FORMAT,
      durationSeconds,
      startedAt.toISOString(),
      endedAt.toISOString(),
    ],
  );

  const id = Number(rows[0]?.id || 0);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`voicemail_recording_insert_missing_id recording=${fileName}`);
  }

  return id;
}

function buildRecordingDownloadUrl(recordingId: number): string {
  const trimmedBase = BACKEND_URL.replace(/\/+$/, '');
  // Tech debt note: do not expose RECORDINGS_INTERNAL_TOKEN in this webhook URL.
  // If download auth is tightened later, prefer signed or header-based auth over plaintext query params.
  return `${trimmedBase}/recordings/${recordingId}/download`;
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
  await detachInboundBridgeForVoicemail(session, ariClient);

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
    format: VOICEMAIL_RECORDING_FORMAT,
    maxDurationSeconds,
    beep: true,
    ifExists: 'overwrite',
  });

  const durationSeconds = await waitForRecordingFinished(ariClient, recordingName, channel.id);
  if (durationSeconds == null || durationSeconds === 0) {
    stasisLogger.log(`[voicemail] skipping save — zero duration call=${session.callUuid}`);
    return 'done';
  }
  
  const recordingId = await persistVoicemailRecording(session, channel.id, recordingName, startedAt, durationSeconds);
  const recordingUrl = buildRecordingDownloadUrl(recordingId);
  session.variables.voicemail_recording_url = recordingUrl;
  session.variables.voicemail_duration_seconds = String(durationSeconds);
  session.webhookPayload.recording = { url: recordingUrl, duration_seconds: durationSeconds ?? 0 };
  session.webhookPayload.outcome = { status: 'completed' };
  await playOutroIfConfigured(channel, node, ariClient);
  stasisLogger.log(`[voicemail] mailbox=${mailboxName} call=${session.callUuid} recording=${recordingName}`);
  return 'done';
}
