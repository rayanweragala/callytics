import * as ari from 'ari-client';

const ARI_URL = process.env.ARI_URL || 'http://localhost:8088';
const ARI_USER = process.env.ARI_USER || 'callytics';
const ARI_PASS = process.env.ARI_PASS || 'callytics';
const ARI_APP = process.env.ARI_APP || 'callytics';

async function start() {
  try {
    console.log(`Connecting to ARI at ${ARI_URL}...`);
    const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);
    console.log('Stasis app connected to ARI');

    client.on('StasisStart', async (event: any, channel: any) => {
      const callerId = event.channel.caller.number || 'unknown';
      console.log(`Call received: ${channel.id} from ${callerId}`);

      try {
        await channel.answer();
        console.log(`Answered channel ${channel.id}`);
        setTimeout(async () => {
          try {
            await channel.hangup();
            console.log(`Hung up channel ${channel.id}`);
          } catch (err) {
            console.log(`Channel ${channel.id} already gone`);
          }
        }, 2000);
      } catch (err) {
        console.error('Error handling call:', err);
      }
    });

    client.start(ARI_APP);
    console.log(`Listening for calls on Stasis app: ${ARI_APP}`);

  } catch (err) {
    console.error('Failed to connect to ARI:', err);
    process.exit(1);
  }
}

start();
