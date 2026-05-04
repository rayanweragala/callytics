import { CallSession, type CallRecordingState } from './callSession';
import { logEvent } from './logger';

function recordingAuthHeader() {
  const ariUser = process.env.ARI_USER || 'callytics';
  const ariPass = process.env.ARI_PASS || 'callytics';
  return `Basic ${Buffer.from(`${ariUser}:${ariPass}`).toString('base64')}`;
}

function ariBaseUrl(): string {
  return (process.env.ARI_URL || 'http://127.0.0.1:8088').replace(/\/+$/, '');
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
