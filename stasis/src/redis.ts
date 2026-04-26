import { stasisLogger } from "./logger";
import { createClient, RedisClientType } from 'redis';

let publisher: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;

async function ensurePublisher(): Promise<RedisClientType> {
  if (!publisher) {
    publisher = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });

    publisher.on('error', (error) => {
      stasisLogger.error('Redis publisher error:', error);
    });

    await publisher.connect();
  }

  return publisher;
}

export async function getPublisher(): Promise<RedisClientType> {
  return ensurePublisher();
}

export async function getSubscriber(): Promise<RedisClientType> {
  const pub = await ensurePublisher();
  if (!subscriber) {
    subscriber = pub.duplicate({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });
    subscriber.on('error', (error) => {
      stasisLogger.error('Redis subscriber error:', error);
    });
    await subscriber.connect();
  }
  return subscriber;
}

export async function publish(channel: string, payload: unknown): Promise<void> {
  const client = await getPublisher();
  await client.publish(channel, JSON.stringify(payload));
}
