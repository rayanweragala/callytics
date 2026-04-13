import * as dotenv from 'dotenv';
dotenv.config();

import * as ari from 'ari-client';
import { addSession, createSession, getSession, removeSession } from './callSession';
import { loadFlow } from './flowLoader';
import migrate from './migrate';
import { runFlow } from './runtime';
import seed from './seed';
import { startAmiMonitor } from './amiMonitor';
import { publishCallEndTelemetry } from './telemetry';
import { resolveTransferWaiter } from './transferManager';
import { resolveHuntWaiter } from './huntManager';

const ARI_URL = process.env.ARI_URL || 'http://127.0.0.1:8088';
const ARI_USER = process.env.ARI_USER || 'callytics';
const ARI_PASS = process.env.ARI_PASS || 'callytics';
const ARI_APP = process.env.ARI_APP || 'callytics';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const RECORDINGS_INTERNAL_TOKEN = process.env.RECORDINGS_INTERNAL_TOKEN || '';

function buildAriUrl(path: string, query?: Record<string, string>): string {
  const trimmedBase = ARI_URL.replace(/\/+$/, '');
  const url = new URL(`${trimmedBase}/ari${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function ariRequest(path: string, options: RequestInit = {}, query?: Record<string, string>): Promise<Response> {
  return fetch(buildAriUrl(path, query), {
    ...options,
    headers: {
      Authorization: `Basic ${Buffer.from(`${ARI_USER}:${ARI_PASS}`).toString('base64')}`,
      ...(options.headers || {}),
    },
  });
}

async function startBridgeRecording(
  bridgeId: string,
  callId: string,
): Promise<{ name: string; fileName: string; filePath: string; format: string; startedAt: Date; endedAt: Date | null }> {
  const name = callId;
  const format = 'wav';
  const startedAt = new Date();
  console.log(`[recording] start request bridge=${bridgeId} call_id=${callId} at=${startedAt.toISOString()}`);

  const response = await ariRequest(
    `/bridges/${encodeURIComponent(bridgeId)}/record`,
    { method: 'POST' },
    {
      name,
      format,
      maxDurationSeconds: '3600',
      maxSilenceSeconds: '0',
      ifExists: 'overwrite',
      beep: 'false',
      terminateOn: 'none',
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_start_failed status=${response.status} body=${body}`);
  }

  console.log(`[recording] start ok bridge=${bridgeId} call_id=${callId} at=${new Date().toISOString()}`);
  return {
    name,
    fileName: `${name}.${format}`,
    filePath: `/var/lib/asterisk/recording/${name}.${format}`,
    format,
    startedAt,
    endedAt: null,
  };
}

async function createInboundBridge(
  ariClient: unknown,
  channelId: string,
): Promise<{ id: string }> {
  const client = ariClient as {
    bridges: {
      create: (params: { type: string; name?: string }) => Promise<{ id: string }>;
      addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
    };
  };

  const bridge = await client.bridges.create({ type: 'mixing', name: `inbound-${channelId}` });
  await client.bridges.addChannel({ bridgeId: bridge.id, channel: channelId });
  console.log(`[bridge] created inbound bridge=${bridge.id} channel=${channelId} at=${new Date().toISOString()}`);
  return { id: bridge.id };
}

async function destroyInboundBridge(
  ariClient: unknown,
  bridgeId: string,
): Promise<void> {
  const client = ariClient as {
    bridges: {
      destroy: (params: { bridgeId: string }) => Promise<void>;
    };
  };

  try {
    await client.bridges.destroy({ bridgeId });
    console.log(`[bridge] destroyed inbound bridge=${bridgeId} at=${new Date().toISOString()}`);
  } catch (error) {
    console.error(`[bridge] destroy failed bridge=${bridgeId}:`, error);
  }
}

async function stopInboundRecording(name: string): Promise<void> {
  const response = await ariRequest(`/recordings/live/${encodeURIComponent(name)}/stop`, { method: 'POST' });
  if (response.status === 404) {
    return;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_stop_failed status=${response.status} body=${body}`);
  }
}

async function persistRecording(session: {
  callUuid: string;
  channelId: string;
  flow: { id: number };
  recording: { name: string; fileName: string; filePath: string; format: string; startedAt: Date; endedAt: Date | null } | null;
}): Promise<void> {
  if (!session.recording) {
    return;
  }

  const endedAt = session.recording.endedAt || new Date();
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - session.recording.startedAt.getTime()) / 1000));

  if (!session.recording.endedAt) {
    try {
      await stopInboundRecording(session.recording.name);
    } catch (error) {
      console.error(`[recording] stop failed call_id=${session.callUuid} file=${session.recording.fileName}:`, error);
    }
  }

  const response = await fetch(`${BACKEND_URL}/recordings/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': RECORDINGS_INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      callId: session.callUuid,
      channelId: session.channelId,
      flowId: session.flow.id,
      fileName: session.recording.fileName,
      filePath: session.recording.filePath,
      format: session.recording.format,
      durationSeconds,
      startedAt: session.recording.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_persist_failed status=${response.status} body=${body}`);
  }

  console.log(`[recording] saved call_id=${session.callUuid} file=${session.recording.fileName} duration=${durationSeconds}s`);
}

async function start(): Promise<void> {
  console.log('Running database migrations...');
  await migrate();

  console.log('Seeding database...');
  await seed();

  startAmiMonitor();

  console.log(`Connecting to ARI at ${ARI_URL}...`);

  try {
    const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
    console.log('Stasis app connected to ARI');

    client.on('StasisStart', async (
      event: {
        args?: string[];
        channel?: {
          caller?: { number?: string };
          dialplan?: { context?: string; exten?: string };
        };
      },
      channel: { id: string; answer: () => Promise<void>; hangup: () => Promise<void> },
    ) => {
      if (event.args?.[0] === 'transfer-outbound' && event.args[1]) {
        resolveTransferWaiter(event.args[1], channel);
        console.log(`Transfer leg answered: ${channel.id} for ${event.args[1]}`);
        return;
      }

      if (event.args?.[0] === 'hunt-outbound' && event.args[1]) {
        resolveHuntWaiter(event.args[1], channel);
        console.log(`Hunt leg entered Stasis: ${channel.id} token=${event.args[1]}`);
        return;
      }

      const channelContext = String(event.channel?.dialplan?.context || '');
      const channelExten = String(event.channel?.dialplan?.exten || '');
      if (channelContext !== 'callytics-inbound' || !channelExten || channelExten === 'h') {
        console.log(`Ignoring StasisStart for channel ${channel.id} context=${channelContext || 'unknown'} exten=${channelExten || 'unknown'}`);
        return;
      }

      const callerNumber = event.channel?.caller?.number || 'unknown';
      console.log(`Incoming call: ${channel.id} from ${callerNumber}`);

      const flow = await loadFlow();
      if (!flow) {
        console.warn('No published flow found. Hanging up.');
        try {
          await channel.hangup();
        } catch {}
        return;
      }

      const entryNode = flow.nodes.find((node) => node.type === 'start') || flow.nodes[0];
      const session = createSession(channel.id, callerNumber, flow, entryNode.nodeKey);
      addSession(session);

      try {
        await channel.answer();
        session.inboundBridge = await createInboundBridge(client, channel.id);
        if (session.inboundBridge) {
          session.recording = await startBridgeRecording(session.inboundBridge.id, channel.id);
        }
        try {
          await client.applications.subscribe({
            applicationName: ARI_APP,
            eventSource: `channel:${channel.id}`,
          });
          console.log(`Subscribed ARI app ${ARI_APP} to channel:${channel.id}`);
        } catch (error) {
          console.error(`Failed to subscribe ARI app ${ARI_APP} to channel:${channel.id}:`, error);
        }
        await runFlow(channel, session, client);
      } catch (error) {
        console.error('Error running flow:', error);
        if (session.inboundBridge) {
          await destroyInboundBridge(client, session.inboundBridge.id);
          session.inboundBridge = null;
        }
        try {
          await channel.hangup();
        } catch {}
        removeSession(channel.id);
      }
    });

    client.on('StasisEnd', async (_event: unknown, channel: { id: string }) => {
      const session = getSession(channel.id);
      if (!session) {
        return;
      }

      removeSession(channel.id);
      try {
        await persistRecording(session);
      } catch (error) {
        console.error(`[recording] persist failed call_id=${session.callUuid}:`, error);
      }
      if (session.inboundBridge) {
        await destroyInboundBridge(client, session.inboundBridge.id);
      }
      await publishCallEndTelemetry(channel.id, session.flow.id, session.callerNumber);
      console.log(`StasisEnd: ${channel.id}`);
    });

    client.start(ARI_APP);
    console.log(`Listening for calls on Stasis app: ${ARI_APP}`);
  } catch (error) {
    console.error('Failed to connect to ARI:', error);
    process.exit(1);
  }
}

void start();
