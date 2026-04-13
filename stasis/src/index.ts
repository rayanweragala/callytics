import * as dotenv from 'dotenv';
dotenv.config();

import * as ari from 'ari-client';
import migrate from './migrate';
import seed from './seed';
import { loadFlow } from './flowLoader';
import { createSession, addSession, removeSession } from './callSession';
import { runFlow } from './runtime';

const ARI_URL = process.env.ARI_URL || 'http://localhost:8088';
const ARI_USER = process.env.ARI_USER || 'callytics';
const ARI_PASS = process.env.ARI_PASS || 'callytics';
const ARI_APP  = process.env.ARI_APP  || 'callytics';

async function start() {
  console.log('Running database migrations...');
  await migrate();

  console.log('Seeding database...');
  await seed();

  console.log(`Connecting to ARI at ${ARI_URL}...`);

  try {
    const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
    console.log('Stasis app connected to ARI');

    client.on('StasisStart', async (event: any, channel: any) => {
      const callerNumber = event.channel.caller.number || 'unknown';
      console.log(`Incoming call: ${channel.id} from ${callerNumber}`);

      const flow = await loadFlow();

      if (!flow) {
        console.warn('No published flow found. Hanging up.');
        try { await channel.hangup(); } catch (_) {}
        return;
      }

      const entryNode = flow.nodes.find(n => n.type === 'start') 
        || flow.nodes[0];

      const session = createSession(
        channel.id,
        callerNumber,
        flow,
        entryNode.nodeKey
      );

      addSession(session);

      try {
        await channel.answer();
        await runFlow(channel, session, client);
      } catch (err) {
        console.error('Error running flow:', err);
        removeSession(channel.id);
      }
    });

    client.on('StasisEnd', (event: any, channel: any) => {
      removeSession(channel.id);
      console.log(`StasisEnd: ${channel.id}`);
    });

    client.start(ARI_APP);
    console.log(`Listening for calls on Stasis app: ${ARI_APP}`);

  } catch (err) {
    console.error('Failed to connect to ARI:', err);
    process.exit(1);
  }
}

start();
