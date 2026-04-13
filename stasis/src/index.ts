import * as dotenv from 'dotenv';
dotenv.config();

import * as ari from 'ari-client';
import { addSession, createSession, removeSession } from './callSession';
import { loadFlow } from './flowLoader';
import migrate from './migrate';
import { runFlow } from './runtime';
import seed from './seed';
import { startAmiMonitor } from './amiMonitor';

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

    client.on('StasisStart', async (event: { channel?: { caller?: { number?: string } } }, channel: { id: string; answer: () => Promise<void>; hangup: () => Promise<void> }) => {
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
        await runFlow(channel, session, client);
      } catch (error) {
        console.error('Error running flow:', error);
        removeSession(channel.id);
      }
    });

    client.on('StasisEnd', (_event: unknown, channel: { id: string }) => {
      removeSession(channel.id);
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
