import { createClient, RedisClientType } from 'redis';

let _redis: RedisClientType | null = null;
const DEFAULT_MOH_CLASS = process.env.QUEUE_LOGIN_MOH_CLASS || 'callytics-hold';

async function getRedis(): Promise<RedisClientType> {
  if (!_redis) {
    _redis = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    }) as RedisClientType;
    _redis.on('error', (error: unknown) => {
      console.error('[queueManager] Redis error:', error);
    });
    await _redis.connect();
  }
  return _redis;
}

type AriClient = {
  channels: {
    originate?: (params: unknown) => Promise<unknown>;
    stopMoh?: (params: { channelId: string }) => Promise<void>;
    startMoh?: (params: { channelId: string; mohClass?: string }) => Promise<void>;
  };
  bridges: {
    create: (params: { type: string }) => Promise<{ id: string }>;
    addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
    destroy?: (params: { bridgeId: string }) => Promise<void>;
  };
  on: (event: string, listener: (event: unknown) => void) => void;
  removeListener: (event: string, listener: (event: unknown) => void) => void;
};

/**
 * Login an operator to a queue.
 * - Stores Redis state.
 * - If there are waiting customers, immediately bridges to the first.
 */
export async function loginOperator(
  queueId: number,
  operatorId: number,
  channelId: string,
  ariClient: AriClient,
): Promise<void> {
  const redis = await getRedis();
  const queueStr = String(queueId);
  const opStr = String(operatorId);

  await redis.set(`operator:${opStr}:queue`, queueStr);
  await redis.set(`operator:${opStr}:channel`, channelId);

  const waitingLen = await redis.lLen(`queue:${queueStr}:waiting`);
  if (waitingLen > 0) {
    const customerChannelId = await redis.lPop(`queue:${queueStr}:waiting`);
    if (customerChannelId) {
      await bridgeChannels(queueId, operatorId, channelId, customerChannelId, ariClient);
      await redis.sAdd(`queue:${queueStr}:busy`, opStr);
      await redis.set(`queue:${queueStr}:customer:${customerChannelId}:channel`, channelId);
      return;
    }
  }

  // No waiting customers — add to free set
  await redis.sAdd(`queue:${queueStr}:operators`, opStr);
}

/**
 * Logout an operator and remove from all Redis state.
 */
export async function logoutOperator(
  operatorId: number,
  queueId: number,
): Promise<void> {
  const redis = await getRedis();
  const opStr = String(operatorId);
  const queueStr = String(queueId);

  await redis.sRem(`queue:${queueStr}:operators`, opStr);
  await redis.sRem(`queue:${queueStr}:busy`, opStr);
  await redis.del(`operator:${opStr}:queue`);
  await redis.del(`operator:${opStr}:channel`);
}

/**
 * Bridge the next waiting customer to an available operator.
 */
export async function connectNextCustomer(
  queueId: number,
  ariClient: AriClient,
): Promise<void> {
  const redis = await getRedis();
  const queueStr = String(queueId);

  const operatorId = await redis.sPop(`queue:${queueStr}:operators`);
  if (!operatorId) return;

  const customerChannelId = await redis.lPop(`queue:${queueStr}:waiting`);
  if (!customerChannelId) {
    // No customer — put operator back in free set
    await redis.sAdd(`queue:${queueStr}:operators`, operatorId);
    return;
  }

  const operatorChannelId = await redis.get(`operator:${operatorId}:channel`);
  if (!operatorChannelId) {
    await redis.sAdd(`queue:${queueStr}:operators`, operatorId);
    return;
  }

  await redis.sAdd(`queue:${queueStr}:busy`, operatorId);
  await bridgeChannels(queueId, Number(operatorId), operatorChannelId, customerChannelId, ariClient);
}

/**
 * Called when a customer hangs up.
 * Moves operator back to free set and connects next waiting customer.
 */
export async function onCustomerHangup(
  operatorId: number,
  queueId: number,
  ariClient: AriClient,
): Promise<void> {
  const redis = await getRedis();
  const queueStr = String(queueId);
  const opStr = String(operatorId);

  await redis.sRem(`queue:${queueStr}:busy`, opStr);
  await redis.sAdd(`queue:${queueStr}:operators`, opStr);

  const operatorChannelId = await redis.get(`operator:${opStr}:channel`);
  if (operatorChannelId) {
    await ariClient.channels.startMoh?.({
      channelId: operatorChannelId,
      mohClass: DEFAULT_MOH_CLASS,
    }).catch(() => undefined);
  }

  // Try to connect next waiting customer
  await connectNextCustomer(queueId, ariClient);
}

async function bridgeChannels(
  queueId: number,
  operatorId: number,
  operatorChannelId: string,
  customerChannelId: string,
  ariClient: AriClient,
): Promise<void> {
  try {
    await ariClient.channels.stopMoh?.({ channelId: operatorChannelId }).catch(() => undefined);
    const bridge = await ariClient.bridges.create({ type: 'mixing' });
    await ariClient.bridges.addChannel({ bridgeId: bridge.id, channel: operatorChannelId });
    await ariClient.bridges.addChannel({ bridgeId: bridge.id, channel: customerChannelId });
    console.log(`[queueManager] bridge created id=${bridge.id} queue=${queueId} operator=${operatorId} customer=${customerChannelId}`);
  } catch (error) {
    console.error(`[queueManager] bridge failed queue=${queueId} operator=${operatorId}:`, error);
  }
}
