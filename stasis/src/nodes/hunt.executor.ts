import { CallSession } from '../callSession';
import { resolveAudioMediaPath } from '../audioResolver';
import { FlowNode } from '../flowLoader';
import { registerHuntWaiter } from '../huntManager';

interface HuntExecutorChannel {
  id: string;
  hangup: () => Promise<void>;
  state?: string;
}

interface AriLike {
  Playback: () => { id: string; stop?: () => Promise<void> };
  on: (event: string, listener: (event: { channel?: { id?: string; state?: string }; playback?: { id?: string } }) => void) => void;
  removeListener: (event: string, listener: (event: { channel?: { id?: string; state?: string }; playback?: { id?: string } }) => void) => void;
  channels: {
    originate: (params: { endpoint: string; app: string; appArgs: string; callerId: string; timeout: number }) => Promise<void>;
  };
  bridges: {
    addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
    play: (params: { bridgeId: string; media: string; playbackId?: string; announcer_format?: string }) => Promise<void>;
  };
}

interface HoldLoopController {
  stop: () => Promise<void>;
}

interface GroupWaitResult {
  status: 'answered' | 'failed' | 'timeout' | 'hangup';
  channelId: string | null;
}

function getSessionBridgeId(session: CallSession): string | null {
  return session.inboundBridge?.id || null;
}

async function playBridgeMedia(ariClient: AriLike, bridgeId: string, media: string, playbackId: string): Promise<void> {
  await ariClient.bridges.play({
    bridgeId,
    media,
    playbackId,
    announcer_format: 'ulaw',
  });
}

function waitForPlaybackFinished(ariClient: AriLike, playbackId: string, channelId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinished = (event: { playback?: { id?: string } }) => {
      if (event.playback?.id !== playbackId) {
        return;
      }
      cleanup();
      resolve();
    };

    const onHangup = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channelId) {
        return;
      }
      cleanup();
      reject(new Error('hangup'));
    };

    const cleanup = () => {
      ariClient.removeListener('PlaybackFinished', onFinished);
      ariClient.removeListener('StasisEnd', onHangup);
      ariClient.removeListener('ChannelDestroyed', onHangup);
    };

    ariClient.on('PlaybackFinished', onFinished);
    ariClient.on('StasisEnd', onHangup);
    ariClient.on('ChannelDestroyed', onHangup);
  });
}

async function stopPlayback(playback: { stop?: () => Promise<void> } | null): Promise<void> {
  if (!playback?.stop) {
    return;
  }

  await Promise.race([
    playback.stop().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
}

function startHoldLoop(
  ariClient: AriLike,
  bridgeId: string,
  inboundChannelId: string,
  media: string,
): HoldLoopController {
  let active = true;
  let currentPlayback: { id: string; stop?: () => Promise<void> } | null = null;

  const loop = async () => {
    while (active) {
      const playback = ariClient.Playback();
      currentPlayback = playback;
      try {
        await playBridgeMedia(ariClient, bridgeId, media, playback.id);
        await waitForPlaybackFinished(ariClient, playback.id, inboundChannelId);
      } catch {
        if (!active) {
          break;
        }
      }
    }
  };

  void loop();

  return {
    stop: async () => {
      active = false;
      await stopPlayback(currentPlayback);
    },
  };
}

async function playOnceOnBridge(
  ariClient: AriLike,
  bridgeId: string,
  inboundChannelId: string,
  media: string,
): Promise<void> {
  const playback = ariClient.Playback();
  await playBridgeMedia(ariClient, bridgeId, media, playback.id);
  await waitForPlaybackFinished(ariClient, playback.id, inboundChannelId);
}

async function captureOriginatedChannel(
  ariClient: AriLike,
  destination: string,
  inboundChannelId: string,
  callerId: string,
  timeoutMs: number,
): Promise<HuntExecutorChannel | null> {
  const token = `${inboundChannelId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const appName = process.env.ARI_APP || 'callytics';
  const waiter = registerHuntWaiter(token);
  const normalizedDestination = destination.includes('/')
    ? destination
    : `PJSIP/${destination}`;

  if (normalizedDestination !== destination) {
    console.log(`[hunt] normalized destination ${destination} → ${normalizedDestination}`);
  }

  await ariClient.channels.originate({
    endpoint: normalizedDestination,
    app: appName,
    appArgs: `hunt-outbound,${token}`,
    callerId,
    timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
  });

  return await Promise.race([
    waiter,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.min(timeoutMs, 5000))),
  ]);
}

function waitForFirstAnswerOrAllDone(
  ariClient: AriLike,
  channelIds: string[],
  inboundChannelId: string,
  timeoutMs: number,
): Promise<GroupWaitResult> {
  return new Promise((resolve) => {
    const remaining = new Set(channelIds);
    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const settle = (result: GroupWaitResult) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve(result);
    };

    const onStateChange = (event: { channel?: { id?: string; state?: string } }) => {
      const channelId = event.channel?.id || '';
      if (!remaining.has(channelId)) {
        return;
      }
      if (event.channel?.state === 'Up') {
        settle({ status: 'answered', channelId });
      }
    };

    const onTerminal = (event: { channel?: { id?: string } }) => {
      const channelId = event.channel?.id || '';
      if (channelId === inboundChannelId) {
        settle({ status: 'hangup', channelId });
        return;
      }
      if (!remaining.has(channelId)) {
        return;
      }
      remaining.delete(channelId);
      if (remaining.size === 0) {
        settle({ status: 'failed', channelId: null });
      }
    };

    const cleanup = () => {
      ariClient.removeListener('ChannelStateChange', onStateChange);
      ariClient.removeListener('StasisEnd', onTerminal);
      ariClient.removeListener('ChannelDestroyed', onTerminal);
      if (timer) {
        clearTimeout(timer);
      }
    };

    ariClient.on('ChannelStateChange', onStateChange);
    ariClient.on('StasisEnd', onTerminal);
    ariClient.on('ChannelDestroyed', onTerminal);
    timer = setTimeout(() => settle({ status: 'timeout', channelId: null }), timeoutMs);
  });
}

function waitForChannelEnd(
  ariClient: AriLike,
  channelIds: string[],
): Promise<string> {
  return new Promise((resolve) => {
    const onEnd = (event: { channel?: { id?: string } }) => {
      const channelId = event.channel?.id || '';
      if (!channelIds.includes(channelId)) {
        return;
      }
      cleanup();
      resolve(channelId);
    };

    const cleanup = () => {
      ariClient.removeListener('StasisEnd', onEnd);
      ariClient.removeListener('ChannelDestroyed', onEnd);
    };

    ariClient.on('StasisEnd', onEnd);
    ariClient.on('ChannelDestroyed', onEnd);
  });
}

async function hangupChannels(channels: HuntExecutorChannel[], keepChannelId?: string | null): Promise<void> {
  await Promise.allSettled(
    channels
      .filter((channel) => channel.id !== keepChannelId)
      .map((channel) => channel.hangup().catch(() => undefined)),
  );
}

function normalizeDestinations(config: Record<string, unknown>): string[] {
  if (!Array.isArray(config.destinations)) {
    return [];
  }

  return config.destinations
    .map((value) => String(value || '').trim())
    .filter((value) => value.length > 0);
}

function nextRandomDestination(destinations: string[], lastDestination: string | null): string {
  if (destinations.length <= 1) {
    return destinations[0] || '';
  }

  const options = destinations.filter((destination) => destination !== lastDestination);
  return options[Math.floor(Math.random() * options.length)] || destinations[0] || '';
}

function noAnswerResult(config: Record<string, unknown>): string {
  const nodeKey = String(config.on_no_answer || '').trim();
  return nodeKey ? `route:${nodeKey}` : 'hangup';
}

async function resolveOptionalBridgeMedia(
  config: Record<string, unknown>,
  idField: string,
  pathField: string,
): Promise<string | null> {
  const mediaPath = await resolveAudioMediaPath(config, idField, pathField);
  return mediaPath ? `sound:${mediaPath}` : null;
}

export async function executeHunt(
  channel: HuntExecutorChannel,
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  const client = ariClient as AriLike;
  const bridgeId = getSessionBridgeId(session);
  const destinations = normalizeDestinations(node.config);
  const strategy = String(node.config.strategy || 'sequential').trim().toLowerCase();
  const attemptTimeoutMs = Math.max(1, Number(node.config.attempt_timeout_ms) || 20000);
  const totalTimeoutMs = Math.max(1, Number(node.config.total_timeout_ms) || 60000);
  const startTime = Date.now();
  let lastDestination: string | null = null;
  let holdLoop: HoldLoopController | null = null;
  let pendingChannels: HuntExecutorChannel[] = [];
  let inboundEnded = false;

  const onInboundTerminal = (event: { channel?: { id?: string } }) => {
    if (event.channel?.id !== channel.id) {
      return;
    }
    inboundEnded = true;
  };

  if (!bridgeId || destinations.length === 0) {
    console.log(`[hunt] missing bridge or destinations channel=${channel.id} bridge=${bridgeId || 'none'} destinations=${destinations.length}`);
    return noAnswerResult(node.config);
  }

  client.on('StasisEnd', onInboundTerminal);
  client.on('ChannelDestroyed', onInboundTerminal);

  const holdMedia = await resolveOptionalBridgeMedia(node.config, 'hold_audio_file_id', 'hold_audio_file_path');
  const busyMedia = await resolveOptionalBridgeMedia(node.config, 'busy_audio_file_id', 'busy_audio_file_path');

  const startHold = () => {
    if (!holdMedia || holdLoop) {
      return;
    }
    console.log(`[hunt] starting hold loop channel=${channel.id} media=${holdMedia}`);
    holdLoop = startHoldLoop(client, bridgeId, channel.id, holdMedia);
  };

  const stopHold = async () => {
    if (!holdLoop) {
      return;
    }
    await holdLoop.stop();
    holdLoop = null;
    console.log(`[hunt] stopped hold loop channel=${channel.id}`);
  };

  const finalizeAnswer = async (answeredChannel: HuntExecutorChannel): Promise<string> => {
    await stopHold();
    await hangupChannels(pendingChannels, answeredChannel.id);
    pendingChannels = [answeredChannel];
    console.log(`[hunt] adding answered channel to bridge inbound=${channel.id} outbound=${answeredChannel.id} bridge=${bridgeId}`);
    await client.bridges.addChannel({ bridgeId, channel: answeredChannel.id });
    const endedChannelId = await waitForChannelEnd(client, [channel.id, answeredChannel.id]);
    if (endedChannelId === channel.id) {
      await hangupChannels([answeredChannel]);
    } else {
      await channel.hangup().catch(() => undefined);
    }
    return 'done';
  };

  try {
    if (strategy === 'group') {
      startHold();
      const createResults = await Promise.allSettled(
        destinations.map(async (destination) => {
          console.log(`[hunt] group originate destination=${destination} timeout_ms=${totalTimeoutMs}`);
          return await captureOriginatedChannel(client, destination, channel.id, session.callerNumber, totalTimeoutMs);
        }),
      );

      pendingChannels = createResults
        .flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []));

      if (pendingChannels.length === 0) {
        await stopHold();
        return noAnswerResult(node.config);
      }

      const alreadyAnswered = pendingChannels.find((item) => String(item.state || '').toLowerCase() === 'up');
      if (alreadyAnswered) {
        console.log(`[hunt] group leg already up channel=${alreadyAnswered.id}`);
        return await finalizeAnswer(alreadyAnswered);
      }

      const outcome = await waitForFirstAnswerOrAllDone(
        client,
        pendingChannels.map((item) => item.id),
        channel.id,
        totalTimeoutMs,
      );
      if (outcome.status === 'hangup' || inboundEnded) {
        await stopHold();
        await hangupChannels(pendingChannels);
        pendingChannels = [];
        return 'hangup';
      }
      if (outcome.status === 'answered' && outcome.channelId) {
        const answered = pendingChannels.find((item) => item.id === outcome.channelId);
        if (answered) {
          console.log(`[hunt] group answered channel=${answered.id}`);
          return await finalizeAnswer(answered);
        }
      }

      await stopHold();
      await hangupChannels(pendingChannels);
      pendingChannels = [];
      console.log(`[hunt] group exhausted result=no-answer`);
      return noAnswerResult(node.config);
    }

    let sequentialIndex = 0;
    while (Date.now() - startTime < totalTimeoutMs) {
      const remainingMs = totalTimeoutMs - (Date.now() - startTime);
      if (remainingMs <= 0) {
        break;
      }
      if (inboundEnded) {
        return 'hangup';
      }

      const destination = strategy === 'random'
        ? nextRandomDestination(destinations, lastDestination)
        : destinations[sequentialIndex % destinations.length] || '';
      sequentialIndex += 1;
      lastDestination = destination;
      const dialTimeoutMs = Math.min(attemptTimeoutMs, remainingMs);

      startHold();
      console.log(`[hunt] originate strategy=${strategy} destination=${destination} attempt_timeout_ms=${dialTimeoutMs} remaining_ms=${remainingMs}`);

      let outboundChannel: HuntExecutorChannel | null = null;
      try {
        outboundChannel = await captureOriginatedChannel(client, destination, channel.id, session.callerNumber, dialTimeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[hunt] failed attempt destination=${destination} error=${message}`);
        outboundChannel = null;
      }

      if (!outboundChannel) {
        console.log(`[hunt] originate failed destination=${destination}`);
      } else {
        pendingChannels = [outboundChannel];
        console.log(
          `[hunt] outbound leg entered stasis destination=${destination} channel=${outboundChannel.id} state=${String(outboundChannel.state || 'unknown')}`,
        );
        // In this call flow, outbound legs only enter the hunt-outbound Stasis app once the
        // destination has effectively answered. Bridge immediately to avoid missing late/absent
        // ChannelStateChange events and trapping caller on hold.
        return await finalizeAnswer(outboundChannel);
      }

      const remainingAfterAttempt = totalTimeoutMs - (Date.now() - startTime);
      if (remainingAfterAttempt <= 0) {
        break;
      }
      if (inboundEnded) {
        return 'hangup';
      }

      if (busyMedia) {
        console.log(`[hunt] playing busy media=${busyMedia}`);
        await playOnceOnBridge(client, bridgeId, channel.id, busyMedia);
      }
    }

    await stopHold();
    await hangupChannels(pendingChannels);
    pendingChannels = [];
    console.log(`[hunt] exhausted returning=${noAnswerResult(node.config)}`);
    return noAnswerResult(node.config);
  } catch (error) {
    await stopHold();
    await hangupChannels(pendingChannels);
    pendingChannels = [];
    const message = error instanceof Error ? error.message : String(error);
    if (inboundEnded || message === 'hangup') {
      return 'hangup';
    }
    console.error(`[hunt] fatal error, routing to on_no_answer: ${message}`);
    return noAnswerResult(node.config);
  } finally {
    client.removeListener('StasisEnd', onInboundTerminal);
    client.removeListener('ChannelDestroyed', onInboundTerminal);
  }
}
