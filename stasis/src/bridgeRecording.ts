import { CallSession, type CallRecordingState } from './callSession';
import { logEvent } from './logger';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const RECORDINGS_INTERNAL_TOKEN = process.env.RECORDINGS_INTERNAL_TOKEN || '';

function recordingAuthHeader() {
  const ariUser = process.env.ARI_USER || 'callytics';
  const ariPass = process.env.ARI_PASS || 'callytics';
  return `Basic ${Buffer.from(`${ariUser}:${ariPass}`).toString('base64')}`;
}

function ariBaseUrl(): string {
  return (process.env.ARI_URL || 'http://127.0.0.1:8088').replace(/\/+$/, '');
}

function recordingBackendBaseUrl(): string {
  return BACKEND_URL.replace(/\/+$/, '');
}

function buildRecordingDownloadUrl(recordingId: number): string {
  // Tech debt note: do not expose RECORDINGS_INTERNAL_TOKEN in this webhook URL.
  // If download auth changes later, prefer signed or header-based auth over plaintext query params.
  return `${recordingBackendBaseUrl()}/recordings/${recordingId}/download`;
}

export async function stopLiveRecording(name: string): Promise<void> {
  const response = await fetch(`${ariBaseUrl()}/ari/recordings/live/${encodeURIComponent(name)}/stop`, {
    method: 'POST',
    headers: { Authorization: recordingAuthHeader() },
  });

  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_stop_failed status=${response.status} body=${body}`);
  }
}

export async function startLiveBridgeRecording(bridgeId: string, recordingBaseName: string): Promise<CallRecordingState> {
  const format = 'wav';
  const startedAt = new Date();
  const response = await fetch(`${ariBaseUrl()}/ari/bridges/${encodeURIComponent(bridgeId)}/record?${new URLSearchParams({
    name: recordingBaseName,
    format,
    maxDurationSeconds: '3600',
    maxSilenceSeconds: '0',
    ifExists: 'overwrite',
    beep: 'false',
    terminateOn: 'none',
  }).toString()}`, {
    method: 'POST',
    headers: { Authorization: recordingAuthHeader() },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_start_failed status=${response.status} body=${body}`);
  }

  return {
    name: recordingBaseName,
    fileName: `${recordingBaseName}.${format}`,
    filePath: `/var/lib/asterisk/recording/${recordingBaseName}.${format}`,
    format,
    startedAt,
    endedAt: null,
  };
}

export async function beginNodeRecording(session: CallSession, bridgeId: string, recordingBaseName: string, context: string): Promise<void> {
  if (session.recording && !session.recording.endedAt) {
    try {
      await stopLiveRecording(session.recording.name);
      session.recording.endedAt = new Date();
    } catch (error) {
      logEvent('RecordingStopFailed', { callId: session.callUuid, fileName: session.recording.fileName, error });
    }
  }

  session.recording = await startLiveBridgeRecording(bridgeId, recordingBaseName);
  logEvent('RecordingStarted', {
    callId: session.callUuid,
    context,
    bridgeId,
    fileName: session.recording.fileName,
    filePath: session.recording.filePath,
  });
}

export async function persistSessionRecording(session: CallSession): Promise<{ id: number; recordingUrl: string; durationSeconds: number } | null> {
  if (!session.recording) {
    return null;
  }

  const recording = session.recording;
  const endedAt = recording.endedAt || new Date();
  recording.endedAt = endedAt;
  const durationSeconds = Math.max(
    0,
    Math.round((endedAt.getTime() - recording.startedAt.getTime()) / 1000),
  );

  if (!recording.endedAt) {
    await stopLiveRecording(recording.name);
  }

  const response = await fetch(`${recordingBackendBaseUrl()}/recordings/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': RECORDINGS_INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      callId: session.callUuid,
      channelId: session.channelId,
      flowId: session.flow.id,
      fileName: recording.fileName,
      filePath: recording.filePath,
      format: recording.format,
      durationSeconds,
      startedAt: recording.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_persist_failed status=${response.status} body=${body}`);
  }

  const payload = (await response.json()) as { data?: { id?: number } };
  const recordingId = Number(payload.data?.id || 0);
  if (!Number.isFinite(recordingId) || recordingId <= 0) {
    throw new Error(`record_persist_missing_id file=${recording.fileName}`);
  }

  session.recording = null;
  return {
    id: recordingId,
    recordingUrl: buildRecordingDownloadUrl(recordingId),
    durationSeconds,
  };
}
