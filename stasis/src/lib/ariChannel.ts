import { logEvent } from '../logger';

type ChannelLike = { id: string; answer?: unknown; hangup?: unknown } & Record<string, unknown>;

interface ChannelFactoryClient {
  Channel?: (id?: string, values?: Record<string, unknown>) => ChannelLike;
}

/**
 * ari-client passes an event's resources as the second listener argument. For
 * events with more than one resource (StasisStart with replace_channel) that
 * argument is a plain object { channel, replace_channel } and not a Channel
 * instance, so channel.answer is not a function. This returns a real Channel
 * instance in every case.
 */
export function resolveStasisChannel<T extends { id: string }>(
  client: unknown,
  event: { channel?: { id?: string } & Record<string, unknown> },
  resources: unknown,
): T {
  const isChannelInstance = (value: unknown): value is T =>
    typeof value === 'object'
    && value !== null
    && typeof (value as ChannelLike).answer === 'function'
    && typeof (value as ChannelLike).hangup === 'function';

  if (isChannelInstance(resources)) {
    return resources;
  }

  const nested = (resources as { channel?: unknown } | undefined)?.channel;
  if (isChannelInstance(nested)) {
    logEvent('StasisChannelUnwrapped', { channelId: (nested as { id?: string }).id ?? null });
    return nested;
  }

  const eventChannel = event.channel;
  const factory = (client as ChannelFactoryClient).Channel;
  if (eventChannel?.id && typeof factory === 'function') {
    logEvent('StasisChannelRebuilt', { channelId: eventChannel.id });
    return factory.call(client, eventChannel.id, eventChannel) as unknown as T;
  }

  throw new Error(
    `StasisStart delivered no usable channel (channelId=${eventChannel?.id ?? 'unknown'})`,
  );
}
