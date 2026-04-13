import dotenv from 'dotenv';
import ari from 'node-ari-client';

dotenv.config();

const ARI_URL = process.env.ARI_URL ?? 'http://localhost:8088';
const ARI_USER = process.env.ARI_USER ?? 'callytics';
const ARI_PASS = process.env.ARI_PASS ?? 'callytics';
const ARI_APP = process.env.ARI_APP ?? 'callytics';

async function main(): Promise<void> {
  try {
    const client = await ari.connect(ARI_URL, ARI_USER, ARI_PASS);

    client.on('StasisStart', async (event: any, channel: any) => {
      const channelId = channel?.id ?? 'unknown-channel';
      const callerNumber = channel?.caller?.number ?? 'unknown-caller';

      console.log(`Call received: ${channelId} from ${callerNumber}`);

      try {
        await channel.answer();
        setTimeout(async () => {
          try {
            await channel.hangup();
          } catch (hangupError) {
            console.error('Failed to hang up placeholder call:', hangupError);
          }
        }, 2000);
      } catch (channelError) {
        console.error('Failed to process placeholder Stasis call:', channelError);
      }
    });

    await client.start(ARI_APP);
    console.log('Stasis app connected to ARI');
  } catch (error) {
    console.error('Failed to connect to ARI:', error);
    process.exit(1);
  }
}

void main();
