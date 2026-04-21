import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { resolveAudioMediaPath } from '../audioResolver';
import { resolveNodeTimeoutMs } from '../timeoutResolver';

type PlaybackTarget =
  | { kind: 'channel'; id: string; play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void> }
  | { kind: 'bridge'; id: string };

type MenuAttemptResult = 'timeout' | 'invalid' | 'hangup' | string;

function getPlaybackTarget(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void> },
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
  playback: { id: string; stop: () => Promise<void> },
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

function getCounterKey(session: CallSession, node: FlowNode, kind: 'timeout' | 'invalid'): string {
  return `menu:${session.flow.id}:${node.nodeKey}:${kind}_count`;
}

function getCounter(session: CallSession, node: FlowNode, kind: 'timeout' | 'invalid'): number {
  return Number(session.variables[getCounterKey(session, node, kind)] || 0);
}

function setCounter(session: CallSession, node: FlowNode, kind: 'timeout' | 'invalid', value: number): void {
  session.variables[getCounterKey(session, node, kind)] = String(value);
}

function clearCounters(session: CallSession, node: FlowNode): void {
  delete session.variables[getCounterKey(session, node, 'timeout')];
  delete session.variables[getCounterKey(session, node, 'invalid')];
}

function resolveMenuDigit(node: FlowNode, rawDigit: string): string {
  const configuredBranches = Array.isArray(node.config.branches)
    ? node.config.branches.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  if (configuredBranches.includes(rawDigit)) {
    return rawDigit;
  }

  return 'invalid';
}

async function playResolvedPrompt(
  channel: {
    id: string;
    play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void>;
  },
  session: CallSession,
  ariClient: unknown,
  config: Record<string, unknown>,
  idField: string,
  pathField: string,
  logPrefix: string,
): Promise<void> {
  const promptPath = await resolveAudioMediaPath(config, idField, pathField);
  if (!promptPath) {
    return;
  }

  const client = ariClient as {
    Playback: () => { id: string; stop: () => Promise<void> };
  };
  const playback = client.Playback();
  const target = getPlaybackTarget(channel as never, session);
  console.log(`[menu] ${logPrefix} target=${target.kind}:${target.id} media=sound:${promptPath} at=${new Date().toISOString()}`);
  await playMedia(target, ariClient, 'sound:' + promptPath, playback);
}

async function collectMenuAttempt(
  channel: {
    id: string;
    play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void>;
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<MenuAttemptResult> {
  const timeoutMs = resolveNodeTimeoutMs(node, session, 5000);
  const client = ariClient as {
    Playback: () => { id: string; stop: () => Promise<void> };
    on: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  };
  const channelEmitter = channel as {
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  };

  return new Promise(async (resolve, reject) => {
    const playback = client.Playback();
    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      client.removeListener('ChannelDtmfReceived', onDtmf);
      channelEmitter.removeListener?.('ChannelDtmfReceived', onDtmf);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
      if (timer) clearTimeout(timer);
    };

    const stopPlaybackSafely = async () => {
      await Promise.race([
        playback.stop().catch(() => undefined),
        new Promise<void>((resolveStop) => setTimeout(resolveStop, 250)),
      ]);
    };

    const settle = (value: MenuAttemptResult) => {
      if (finished) return;
      finished = true;
      cleanup();
      console.log(`[menu] returning channel=${channel.id} result=${value}`);
      resolve(value);
      void stopPlaybackSafely();
    };

    const onDtmf = async (event: { channel?: { id?: string }; digit?: string }) => {
      if (event.channel?.id && event.channel.id !== channel.id) return;
      const rawDigit = String(event.digit || '');
      console.log(`[menu] ChannelDtmfReceived channel=${channel.id} digit=${rawDigit}`);
      settle(resolveMenuDigit(node, rawDigit));
    };

    const onHangup = async (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) return;
      settle('hangup');
    };

    console.log(`[menu] listening for DTMF on channel=${channel.id}`);
    client.on('ChannelDtmfReceived', onDtmf);
    channelEmitter.on?.('ChannelDtmfReceived', onDtmf);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);

    timer = setTimeout(() => {
      console.log('[menu] timeout fired');
      settle('timeout');
    }, timeoutMs);

    try {
      const promptPath = await resolveAudioMediaPath(node.config, 'prompt_audio_file_id', 'prompt_path');
      if (promptPath) {
        const target = getPlaybackTarget(channel as never, session);
        console.log(`[menu] play request target=${target.kind}:${target.id} media=sound:${promptPath} at=${new Date().toISOString()}`);
        await playMedia(target, ariClient, 'sound:' + promptPath, playback);
        console.log(`[menu] play request returned target=${target.kind}:${target.id} media=sound:${promptPath} playbackId=${playback.id} at=${new Date().toISOString()}`);
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error('menu_failed'));
    }
  });
}

export async function executeMenu(
  channel: {
    id: string;
    play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void>;
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  console.log(`[menu] start channel=${channel.id} config=${JSON.stringify(node.config)}`);
  const maxTimeoutAttempts = Math.max(1, Number(node.config.max_timeout_attempts) || 3);
  const maxInvalidAttempts = Math.max(1, Number(node.config.max_invalid_attempts) || 3);

  while (true) {
    const result = await collectMenuAttempt(channel, node, session, ariClient);

    if (result === 'hangup') {
      clearCounters(session, node);
      return 'hangup';
    }

    if (result === 'timeout') {
      const nextCount = getCounter(session, node, 'timeout') + 1;
      setCounter(session, node, 'timeout', nextCount);

      if (nextCount >= maxTimeoutAttempts) {
        await playResolvedPrompt(channel, session, ariClient, node.config, 'final_failure_audio_id', 'final_failure_path', 'final-failure play request');
        clearCounters(session, node);
        return 'hangup';
      }

      await playResolvedPrompt(channel, session, ariClient, node.config, 'timeout_prompt_audio_id', 'timeout_prompt_path', 'timeout-retry play request');
      continue;
    }

    if (result === 'invalid') {
      const nextCount = getCounter(session, node, 'invalid') + 1;
      setCounter(session, node, 'invalid', nextCount);

      if (nextCount >= maxInvalidAttempts) {
        await playResolvedPrompt(channel, session, ariClient, node.config, 'final_failure_audio_id', 'final_failure_path', 'final-failure play request');
        clearCounters(session, node);
        return 'hangup';
      }

      await playResolvedPrompt(channel, session, ariClient, node.config, 'invalid_prompt_audio_id', 'invalid_prompt_path', 'invalid-retry play request');
      continue;
    }

    clearCounters(session, node);
    return result;
  }
}
