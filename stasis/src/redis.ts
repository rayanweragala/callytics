import { createClient, RedisClientType } from 'redis';

let publisher: RedisClientType | null = null;

async function getPublisher(): Promise<RedisClientType> {
  if (!publisher) {
    publisher = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    });

    publisher.on('error', (error) => {
      console.error('Redis publisher error:', error);
    });

    await publisher.connect();
  }

  return publisher;
}

export async function publish(channel: string, payload: unknown): Promise<void> {
  const client = await getPublisher();
  await client.publish(channel, JSON.stringify(payload));
}
