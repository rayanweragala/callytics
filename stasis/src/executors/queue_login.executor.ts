import * as bcrypt from 'bcrypt';
import { CallSession } from '../callSession';
import { query } from '../db';
import { FlowNode } from '../flowLoader';
import { loginOperator, logoutOperator } from '../engine/queueManager';
import { createClient, RedisClientType } from 'redis';
import { resolveAudioMediaPath } from '../audioResolver';
import { parseValidTimeoutMs, resolveFlowDefaultTimeoutMs } from '../timeoutResolver';

interface QueueLoginConfig {
  queue_id?: number;
  prompt_audio_file_id?: number | null;
  prompt_path?: string | null;
  wrong_pin_audio_file_id?: number | null;
  login_success_audio_file_id?: number | null;
}

interface QueueRow {
  id: number;
  pin_retry_attempts: number;
}

interface OperatorPinRow {
  id: number;
  pin_hash: string;
}

interface FlowEdge {
  sourceNodeKey: string;
  targetNodeKey: string;
}

const DEFAULT_INPUT_TIMEOUT_MS = 10000;
const DEFAULT_MOH_CLASS = process.env.QUEUE_LOGIN_MOH_CLASS || 'callytics-hold';

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

async function waitForDtmfDigits(
  channel: {
    id: string;
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  },
  ariClient: unknown,
  maxDigits: number,
  timeoutMs: number,
  onFirstDigitInterrupt?: () => Promise<void> | void,
): Promise<string | null> {
  const client = ariClient as {
    on: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  };

  return new Promise((resolve) => {
    let digits = '';
    let timer: NodeJS.Timeout | null = null;
    let finished = false;
    let firstDigitHandled = false;
    let lastDigit = '';
    let lastDigitAt = 0;
    const seenEvents = new WeakSet<object>();

    const cleanup = () => {
      client.removeListener('ChannelDtmfReceived', onDtmf);
      channel.removeListener?.('ChannelDtmfReceived', onDtmf);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
      if (timer) clearTimeout(timer);
    };

    const settle = (result: string | null) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    };

    const onDtmf = (event: { channel?: { id?: string }; digit?: string }) => {
      if (event.channel?.id && event.channel.id !== channel.id) return;
      if (event && typeof event === 'object') {
        if (seenEvents.has(event as object)) {
          return;
        }
        seenEvents.add(event as object);
      }
      const digit = String(event.digit || '');
      const now = Date.now();
      if (digit === lastDigit && (now - lastDigitAt) <= 80) {
        return;
      }
      lastDigit = digit;
      lastDigitAt = now;
      console.log(`[queue_login] ChannelDtmfReceived channel=${channel.id} digit=${digit === '#' ? '#' : '*'} digits_len=${digits.length + (digit === '#' ? 0 : 1)}`);
      if (digit === '#') {
        settle(digits || null);
        return;
      }
      if (!firstDigitHandled) {
        firstDigitHandled = true;
        void onFirstDigitInterrupt?.();
      }
      digits += digit;
      if (digits.length >= maxDigits) {
        settle(digits);
      }
    };

    const onHangup = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) return;
      console.log(`[queue_login] input interrupted by hangup channel=${channel.id}`);
      settle(null);
    };

    console.log(`[queue_login] listening for DTMF channel=${channel.id} maxDigits=${maxDigits} timeoutMs=${timeoutMs}`);
    client.on('ChannelDtmfReceived', onDtmf);
    channel.on?.('ChannelDtmfReceived', onDtmf);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);

    timer = setTimeout(() => {
      console.log(`[queue_login] input timeout channel=${channel.id} timeoutMs=${timeoutMs}`);
      settle(null);
    }, timeoutMs);
  });
}

async function playAudioFile(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  session: CallSession,
  ariClient: unknown,
  soundPath: string,
): Promise<void> {
  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  const target = session.inboundBridge ? `bridge:${session.inboundBridge.id}` : `channel:${channel.id}`;
  console.log(`[queue_login] play request target=${target} media=sound:${soundPath} at=${new Date().toISOString()}`);
  if (session.inboundBridge) {
    const client = ariClient as {
      bridges: {
        play: (params: { bridgeId: string; media: string; playbackId?: string; announcer_format?: string }) => Promise<void>;
      };
    };
    await client.bridges.play({
      bridgeId: session.inboundBridge.id,
      media: `sound:${soundPath}`,
      playbackId: playback.id,
      announcer_format: 'ulaw',
    });
    return;
  }
  await channel.play({ media: `sound:${soundPath}` }, playback);
}

async function resolveQueueLoginPromptPath(config: QueueLoginConfig): Promise<string> {
  const resolvedPromptPath = await resolveAudioMediaPath(
    config as unknown as Record<string, unknown>,
    'prompt_audio_file_id',
    'prompt_path',
  );
  return resolvedPromptPath || 'custom/queue-enter-pin';
}

function resolveQueueLoginInputTimeoutMs(node: FlowNode, session: CallSession): number {
  const config = (node.config || {}) as QueueLoginConfig & { use_flow_default_timeout?: boolean; input_timeout_ms?: unknown };
  const useFlowDefaultTimeout = config.use_flow_default_timeout !== false;
  const nodeTimeoutMs = parseValidTimeoutMs(config.input_timeout_ms);
  const flowDefaultTimeoutMs = resolveFlowDefaultTimeoutMs(session);

  if (useFlowDefaultTimeout) {
    return flowDefaultTimeoutMs ?? nodeTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS;
  }
  return nodeTimeoutMs ?? flowDefaultTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS;
}

function findSourceMenuNode(
  session: CallSession,
  node: FlowNode,
): FlowNode | null {
  const edges = Array.isArray(session.flow?.edges) ? (session.flow.edges as FlowEdge[]) : [];
  const sourceEdge = edges.find((edge) => edge.targetNodeKey === node.nodeKey);
  if (!sourceEdge) {
    return null;
  }
  const menuNode = session.flow.nodes.find((candidate) => candidate.nodeKey === sourceEdge.sourceNodeKey && candidate.type === 'menu');
  return menuNode || null;
}

async function playMenuInvalidPrompt(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  session: CallSession,
  ariClient: unknown,
  menuNode: FlowNode,
): Promise<void> {
  const invalidPath = await resolveAudioMediaPath(
    menuNode.config as Record<string, unknown>,
    'invalid_prompt_audio_id',
    'invalid_prompt_path',
  );
  if (!invalidPath) {
    return;
  }
  await playAudioFile(channel, session, ariClient, invalidPath);
}

async function routeBackToMenuOnFailure(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<'failed' | string> {
  const menuNode = findSourceMenuNode(session, node);
  if (!menuNode) {
    return 'failed';
  }
  try {
    await playMenuInvalidPrompt(channel, session, ariClient, menuNode);
  } catch {
    // best effort
  }
  return `route:${menuNode.nodeKey}`;
}

async function startOperatorHoldAudio(
  channelId: string,
  session: CallSession,
  ariClient: unknown,
): Promise<void> {
  const client = ariClient as {
    channels?: { startMoh?: (params: { channelId: string; mohClass?: string }) => Promise<void> };
    bridges?: { startMoh?: (params: { bridgeId: string; mohClass?: string }) => Promise<void> };
  };

  if (client.channels?.startMoh) {
    try {
      await client.channels.startMoh({ channelId, mohClass: DEFAULT_MOH_CLASS });
      console.log(`[queue_login] hold audio started target=channel:${channelId} class=${DEFAULT_MOH_CLASS}`);
      return;
    } catch (error) {
      console.warn(`[queue_login] hold audio start failed target=channel:${channelId}:`, error);
    }
  }

  if (session.inboundBridge?.id && client.bridges?.startMoh) {
    await client.bridges.startMoh({ bridgeId: session.inboundBridge.id, mohClass: DEFAULT_MOH_CLASS });
    console.log(`[queue_login] hold audio started target=bridge:${session.inboundBridge.id} class=${DEFAULT_MOH_CLASS}`);
    return;
  }

  console.warn(`[queue_login] hold audio start unavailable channel=${channelId}`);
}

async function stopOperatorHoldAudio(
  channelId: string,
  session: CallSession,
  ariClient: unknown,
): Promise<void> {
  const client = ariClient as {
    channels?: { stopMoh?: (params: { channelId: string }) => Promise<void> };
    bridges?: { stopMoh?: (params: { bridgeId: string }) => Promise<void> };
  };

  if (client.channels?.stopMoh) {
    try {
      await client.channels.stopMoh({ channelId });
      console.log(`[queue_login] hold audio stopped target=channel:${channelId}`);
      return;
    } catch {
      // fall through to bridge stop
    }
  }

  if (session.inboundBridge?.id && client.bridges?.stopMoh) {
    await client.bridges.stopMoh({ bridgeId: session.inboundBridge.id });
    console.log(`[queue_login] hold audio stopped target=bridge:${session.inboundBridge.id}`);
    return;
  }
}

export async function executeQueueLogin(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void>; hangup: () => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  const config = (node.config || {}) as QueueLoginConfig;
  const queueId = Number(config.queue_id || 0);

  if (!queueId) {
    console.warn('[queue_login] no queue_id configured');
    return routeBackToMenuOnFailure(channel, node, session, ariClient);
  }

  // Load queue config
  const queueRows = await query(
    'SELECT id, pin_retry_attempts FROM queues WHERE id = $1',
    [queueId],
  ) as QueueRow[];

  if (!queueRows.length) {
    console.warn(`[queue_login] queue ${queueId} not found`);
    return routeBackToMenuOnFailure(channel, node, session, ariClient);
  }

  const queueRow = queueRows[0];
  const maxAttempts = queueRow.pin_retry_attempts;
  console.log(`[queue_login] start queue=${queueId} maxAttempts=${maxAttempts} channel=${channel.id}`);

  // Load operator PIN hashes for operators assigned to this queue
  const operatorRows = await query(
    `SELECT o.id, o.pin_hash
     FROM operators o
     JOIN queue_operators qo ON qo.operator_id = o.id
     WHERE qo.queue_id = $1`,
    [queueId],
  ) as OperatorPinRow[];

  if (!operatorRows.length) {
    console.warn(`[queue_login] no operators assigned to queue ${queueId}`);
    return routeBackToMenuOnFailure(channel, node, session, ariClient);
  }
  console.log(`[queue_login] loaded operators for queue=${queueId} count=${operatorRows.length}`);

  let attemptsLeft = maxAttempts;
  const inputTimeoutMs = resolveQueueLoginInputTimeoutMs(node, session);
  console.log(`[queue_login] effective input timeout queue=${queueId} timeoutMs=${inputTimeoutMs}`);

  while (attemptsLeft > 0) {
    console.log(`[queue_login] attempt start queue=${queueId} attemptsLeft=${attemptsLeft}`);
    const promptPath = await resolveQueueLoginPromptPath(config);

    const playbackFactory = ariClient as { Playback: () => { id: string; stop?: () => Promise<void> } };
    const playback = playbackFactory.Playback();
    let promptActive = false;
    const stopPrompt = async () => {
      if (!promptActive || !playback.stop) return;
      await Promise.race([
        playback.stop().catch(() => undefined),
        new Promise<void>((resolveStop) => setTimeout(resolveStop, 250)),
      ]);
      promptActive = false;
      console.log(`[queue_login] prompt interrupted by input channel=${channel.id}`);
    };

    const promptTask = (async () => {
      try {
        const target = session.inboundBridge ? `bridge:${session.inboundBridge.id}` : `channel:${channel.id}`;
        console.log(`[queue_login] play request target=${target} media=sound:${promptPath} at=${new Date().toISOString()}`);
        promptActive = true;
        if (session.inboundBridge) {
          const client = ariClient as {
            bridges: {
              play: (params: { bridgeId: string; media: string; playbackId?: string; announcer_format?: string }) => Promise<void>;
            };
          };
          await client.bridges.play({
            bridgeId: session.inboundBridge.id,
            media: `sound:${promptPath}`,
            playbackId: playback.id,
            announcer_format: 'ulaw',
          });
        } else {
          await channel.play({ media: `sound:${promptPath}` }, playback as { id: string });
        }
      } catch {
        // If audio fails, still wait for DTMF
      } finally {
        promptActive = false;
      }
    })();

    // Collect up to 6 digits while prompt is playing.
    const input = await waitForDtmfDigits(channel, ariClient, 6, inputTimeoutMs, stopPrompt);
    await promptTask.catch(() => undefined);

    if (input === null) {
      // Hangup during input
      console.log('[queue_login] no input captured (timeout/hangup), routing to menu fallback');
      return routeBackToMenuOnFailure(channel, node, session, ariClient);
    }
    console.log(`[queue_login] collected PIN input length=${input.length}`);
    console.log('[queue_login] collected PIN input pin=***');

    // Compare against each operator's PIN hash
    let matchedOperator: OperatorPinRow | null = null;
    for (const op of operatorRows) {
      const match = await bcrypt.compare(input, op.pin_hash);
      if (match) {
        matchedOperator = op;
        break;
      }
    }

    if (matchedOperator) {
      const operatorId = matchedOperator.id;
      const ariTyped = ariClient as Parameters<typeof loginOperator>[3];
      await loginOperator(queueId, operatorId, channel.id, ariTyped);
      try {
        await startOperatorHoldAudio(channel.id, session, ariClient);
      } catch (error) {
        console.warn(`[queue_login] failed to start hold audio channel=${channel.id}:`, error);
      }

      console.log(`[queue_login] operator ${operatorId} authenticated on queue ${queueId} channel=${channel.id}`);

      // Play login success audio if configured
      if (config.login_success_audio_file_id) {
        try {
          const audioRow = await query(
            `SELECT file_path FROM audio_files WHERE id = $1`,
            [config.login_success_audio_file_id],
          ) as Array<{ file_path: string }>;
          if (audioRow.length && audioRow[0].file_path) {
            await playAudioFile(channel as Parameters<typeof playAudioFile>[0], session, ariClient, audioRow[0].file_path);
          }
        } catch {
          // Best effort — don't block login if audio fails
        }
      }

      // Hold channel open — subscribe to # for logout and channel end
      const logoutPromise = new Promise<void>((resolve) => {
        const client = ariClient as {
          on: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
          removeListener: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
        };

        let done = false;
        const cleanup = () => {
          client.removeListener('ChannelDtmfReceived', onDtmf);
          client.removeListener('StasisEnd', onEnd);
          client.removeListener('ChannelDestroyed', onEnd);
        };
        const finish = () => {
          if (done) return;
          done = true;
          cleanup();
          resolve();
        };
        const onDtmf = (event: { channel?: { id?: string }; digit?: string }) => {
          if (event.channel?.id !== channel.id) return;
          if (event.digit === '#') finish();
        };
        const onEnd = (event: { channel?: { id?: string } }) => {
          if (event.channel?.id === channel.id) finish();
        };
        client.on('ChannelDtmfReceived', onDtmf);
        client.on('StasisEnd', onEnd);
        client.on('ChannelDestroyed', onEnd);
      });

      try {
        await logoutPromise;
      } finally {
        try {
          await stopOperatorHoldAudio(channel.id, session, ariClient);
        } catch {
          // best effort
        }
      }

      await logoutOperator(operatorId, queueId);
      console.log(`[queue_login] operator ${operatorId} logged out from queue ${queueId}`);

      return 'authenticated';
    }

    attemptsLeft--;
    console.log(`[queue_login] PIN mismatch queue=${queueId} attemptsLeft=${attemptsLeft}`);

    // Play wrong PIN audio if configured
    if (config.wrong_pin_audio_file_id) {
      try {
        const redis = await getRedis();
        const audioRow = await query(
          `SELECT file_path FROM audio_files WHERE id = $1`,
          [config.wrong_pin_audio_file_id],
        ) as Array<{ file_path: string }>;
        await redis.disconnect();

        if (audioRow.length && audioRow[0].file_path) {
          await playAudioFile(channel as Parameters<typeof playAudioFile>[0], session, ariClient, audioRow[0].file_path);
        }
      } catch {
        // Best effort
      }
    }

    console.log(`[queue_login] wrong PIN attempt, ${attemptsLeft} left`);
  }

  console.log('[queue_login] attempts exhausted, routing to menu fallback');
  return routeBackToMenuOnFailure(channel, node, session, ariClient);
}
