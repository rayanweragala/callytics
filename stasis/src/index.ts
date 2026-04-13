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

const ARI_URL = process.env.ARI_URL || 'http://127.0.0.1:8088';
const ARI_USER = process.env.ARI_USER || 'callytics';
const ARI_PASS = process.env.ARI_PASS || 'callytics';
const ARI_APP = process.env.ARI_APP || 'callytics';

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
        removeSession(channel.id);
      }
    });

    client.on('StasisEnd', async (_event: unknown, channel: { id: string }) => {
      const session = getSession(channel.id);
      if (!session) {
        return;
      }

      removeSession(channel.id);
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
