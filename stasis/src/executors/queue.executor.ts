import { CallSession } from '../callSession';
import { query } from '../db';
import { FlowNode } from '../flowLoader';
import { onCustomerHangup } from '../engine/queueManager';
import { createClient, RedisClientType } from 'redis';
import { resolveAudioMediaPath } from '../audioResolver';
import { logEvent } from '../logger';
import { beginNodeRecording } from '../bridgeRecording';
import { formatDialNumber } from '../lib/formatDialNumber';
import { fetchTrunkDialFormat } from '../lib/trunkResolver';

interface QueueConfig {
  queue_id?: number;
  prompt_audio_file_id?: number | null;
  prompt_path?: string | null;
  record_call?: boolean;
}

interface QueueRow {
  id: number;
  name: string;
  max_wait_seconds: number;
  wait_audio_file_id: number | null;
}

interface QueuePstnMember {
  number: string;
  trunkId: number;
}

async function getRedis(): Promise<RedisClientType> {
  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
    },
  }) as RedisClientType;
  await client.connect();
  return client;
}

type PlaybackTarget =
  | { kind: 'channel'; id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> }
  | { kind: 'bridge'; id: string };

function getPlaybackTarget(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  session: CallSession,
): PlaybackTarget {
  if (session.inboundBridge) {
    return { kind: 'bridge', id: session.inboundBridge.id };
  }
  return { kind: 'channel', id: channel.id, play: channel.play };
}

async function playMedia(
  target: PlaybackTarget,
  ariClient: unknown,
  media: string,
  playback: { id: string },
): Promise<void> {
  if (target.kind === 'channel') {
    await target.play({ media }, playback);
    return;
  }

  const client = ariClient as {
    bridges: {
      play: (params: { bridgeId: string; media: string; playbackId?: string; announcer_format?: string }) => Promise<void>;
    };
  };

  await client.bridges.play({ bridgeId: target.id, media, playbackId: playback.id, announcer_format: 'ulaw' });
}

async function playQueuePrompt(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  session: CallSession,
  ariClient: unknown,
  config: QueueConfig,
): Promise<void> {
  const promptPath = await resolveAudioMediaPath(config as unknown as Record<string, unknown>, 'prompt_audio_file_id', 'prompt_path');
  if (!promptPath) {
    return;
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  const target = getPlaybackTarget(channel, session);
  logEvent('PlaybackRequest', { nodeType: 'queue', target: `${target.kind}:${target.id}`, media: `sound:${promptPath}`, channelId: channel.id });
  await playMedia(target, ariClient, `sound:${promptPath}`, playback);
}

async function resolveQueuePstnMember(operatorId: number): Promise<QueuePstnMember | null> {
  const rows = await query(
    `
      SELECT
        COALESCE(c.number, o.callback_number) AS number,
        COALESCE(c.trunk_id, o.callback_trunk_id) AS trunk_id
      FROM operators o
      LEFT JOIN contact_numbers c ON c.id = o.contact_number_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [operatorId],
  ) as Array<{ number?: string | null; trunk_id?: number | null }>;

  const row = Array.isArray(rows) ? rows[0] : undefined;
  const number = String(row?.number || '').trim();
  const trunkId = Number(row?.trunk_id || 0);
  if (!number || !trunkId) {
    return null;
  }
  return { number, trunkId };
}

async function originateQueuePstnMember(
  ariClient: unknown,
  operatorId: number,
  queueId: number,
): Promise<string | null> {
  const member = await resolveQueuePstnMember(operatorId);
  if (!member) {
    return null;
  }

  const dialFormat = await fetchTrunkDialFormat(member.trunkId);
  const formattedNumber = formatDialNumber(member.number, dialFormat);
  if (!formattedNumber) {
    logEvent('QueuePstnMemberSkipped', { operatorId, queueId, trunkId: member.trunkId });
    return null;
  }

  const ari = ariClient as {
    channels: {
      originate?: (params: {
        endpoint: string;
        app: string;
        appArgs: string;
        callerId: string;
        timeout: number;
      }) => Promise<{ id?: string } | void>;
    };
  };

  if (!ari.channels.originate) {
    return null;
  }

  const result = await ari.channels.originate({
    endpoint: `PJSIP/${formattedNumber}@trunk-${member.trunkId}`,
    app: process.env.ARI_APP || 'callytics',
    appArgs: `queue-outbound,${queueId},${operatorId}`,
    callerId: '',
    timeout: 30,
  });

  const channelId = String(result && 'id' in result ? result.id || '' : '').trim();
  return channelId || null;
}

export async function executeQueue(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void>; hangup: () => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<'connected' | 'timeout' | 'abandoned'> {
  const config = (node.config || {}) as QueueConfig;
  const queueId = Number(config.queue_id || 0);

  if (!queueId) {
    logEvent('QueueMissingId', { channelId: channel.id, nodeId: node.nodeKey });
    return 'abandoned';
  }

  const queueRows = await query(
    'SELECT id, name, max_wait_seconds, wait_audio_file_id FROM queues WHERE id = $1',
    [queueId],
  ) as QueueRow[];

  if (!queueRows.length) {
    logEvent('QueueNotFound', { queueId, channelId: channel.id });
    return 'abandoned';
  }

  const queueRow = queueRows[0];
  const maxWaitMs = (queueRow.max_wait_seconds || 300) * 1000;
  const queueStr = String(queueId);
  const channelId = channel.id;

  try {
    await playQueuePrompt(channel, session, ariClient, config);
  } catch {
    // best effort prompt playback
  }

  const redis = await getRedis();

  try {
    // Queue executor only connects live operator channels tracked in Redis.
    // PSTN queue members are intentionally out of scope; PSTN routing should happen upstream via transfer/hunt nodes.
    // Check for free operators
    const freeCount = await redis.sCard(`queue:${queueStr}:operators`);

    if (freeCount > 0) {
      // Pop one free operator
      const operatorId = await redis.sPop(`queue:${queueStr}:operators`);
      if (!operatorId) {
        // Race condition — fall through to wait
      } else {
        let operatorChannelId = await redis.get(`operator:${operatorId}:channel`);
        if (!operatorChannelId) {
          operatorChannelId = await originateQueuePstnMember(
            ariClient,
            Number(operatorId),
            queueId,
          );
        }
        if (operatorChannelId) {
          await redis.sAdd(`queue:${queueStr}:busy`, operatorId);

          const ari = ariClient as {
            channels: { originate?: (params: unknown) => Promise<unknown> };
            bridges: {
              create: (params: { type: string }) => Promise<{ id: string }>;
              addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
              destroy?: (params: { bridgeId: string }) => Promise<void>;
            };
            on: (event: string, listener: (event: unknown) => void) => void;
            removeListener: (event: string, listener: (event: unknown) => void) => void;
          };

          await (ari.channels as { stopMoh?: (params: { channelId: string }) => Promise<void> })
            .stopMoh?.({ channelId: operatorChannelId }).catch(() => undefined);

          const bridge = await ari.bridges.create({ type: 'mixing' });
          await ari.bridges.addChannel({ bridgeId: bridge.id, channel: channelId });
          await ari.bridges.addChannel({ bridgeId: bridge.id, channel: operatorChannelId });
          if (Boolean(config.record_call)) {
            const queueName = String(queueRow.name || queueId).replace(/[^a-zA-Z0-9_-]/g, '_');
            await beginNodeRecording(session, bridge.id, `${session.callUuid}-queue-${queueName}-${Date.now()}`, 'queue');
          }

          logEvent('QueueConnected', { customerChannelId: channelId, operatorId, bridgeId: bridge.id, queueId });

          // Subscribe to customer hangup
          await new Promise<void>((resolve) => {
            const onEnd = (event: unknown) => {
              const ev = event as { channel?: { id?: string } };
              if (ev.channel?.id === channelId) {
                ari.removeListener('StasisEnd', onEnd);
                ari.removeListener('ChannelDestroyed', onEnd);
                resolve();
              }
            };
            ari.on('StasisEnd', onEnd);
            ari.on('ChannelDestroyed', onEnd);
          });

          await onCustomerHangup(Number(operatorId), queueId, ari);
          await redis.disconnect();
          return 'connected';
        }
        // Operator channel gone — put back
        await redis.sAdd(`queue:${queueStr}:operators`, operatorId);
      }
    }

    // No free operator — add to waiting list and wait
    await redis.rPush(`queue:${queueStr}:waiting`, channelId);
    logEvent('QueueCustomerWaiting', { customerChannelId: channelId, queueId });

    return await new Promise<'connected' | 'timeout' | 'abandoned'>((resolve) => {
      const ari = ariClient as {
        on: (event: string, listener: (event: unknown) => void) => void;
        removeListener: (event: string, listener: (event: unknown) => void) => void;
      };

      let settled = false;
      let maxWaitTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (maxWaitTimer) clearTimeout(maxWaitTimer);
        ari.removeListener('StasisEnd', onHangup);
        ari.removeListener('ChannelDestroyed', onHangup);
      };

      const settle = (result: 'connected' | 'timeout' | 'abandoned') => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const onHangup = (event: unknown) => {
        const ev = event as { channel?: { id?: string } };
        if (ev.channel?.id !== channelId) return;
        // Remove from waiting list
        redis.lRem(`queue:${queueStr}:waiting`, 1, channelId).catch(() => undefined);
        settle('abandoned');
      };

      ari.on('StasisEnd', onHangup);
      ari.on('ChannelDestroyed', onHangup);

      maxWaitTimer = setTimeout(async () => {
        await redis.lRem(`queue:${queueStr}:waiting`, 1, channelId).catch(() => undefined);
        settle('timeout');
      }, maxWaitMs);

      // Poll Redis for connected signal: queue:{queueId}:customer:{channelId}:channel key existence
      const checkConnected = async () => {
        if (settled) return;
        const operatorChannel = await redis.get(`queue:${queueStr}:customer:${channelId}:channel`).catch(() => null);
        if (operatorChannel) {
          settle('connected');
          return;
        }
        if (!settled) setTimeout(() => void checkConnected(), 500);
      };
      void checkConnected();
    });
  } finally {
    try {
      await redis.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
}
