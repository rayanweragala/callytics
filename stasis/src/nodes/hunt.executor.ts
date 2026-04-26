import { parsePhoneNumber, type CountryCode } from 'libphonenumber-js';
import { CallSession } from '../callSession';
import { resolveAudioMediaPath } from '../audioResolver';
import { FlowNode } from '../flowLoader';
import { registerHuntWaiter, rejectHuntWaiter } from '../huntManager';
import { logEvent } from '../logger';

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
    originate: (params: { endpoint: string; app: string; appArgs: string; callerId: string; timeout: number; channelId?: string }) => Promise<void>;
    hangup: (params: { channelId: string }) => Promise<void>;
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

interface HuntAttemptResult {
  status: 'answered' | 'timeout' | 'failed' | 'hangup';
  channel: HuntExecutorChannel | null;
  attemptChannelId: string;
}

const activeHuntTokens = new Set<string>();

export function isHuntWaiterActive(token: string): boolean {
  return activeHuntTokens.has(token);
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
): Promise<HuntAttemptResult> {
  const token = `${inboundChannelId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const attemptChannelId = `hunt-leg-${token}-${Date.now()}`;
  const appName = process.env.ARI_APP || 'callytics';
  const waiter = registerHuntWaiter(token);
  activeHuntTokens.add(token);
  let timeoutHandle: NodeJS.Timeout | null = null;
  let timedOut = false;
  let inboundTerminated = false;

  const onInboundTerminal = (event: { channel?: { id?: string } }) => {
    if (event.channel?.id !== inboundChannelId) {
      return;
    }
    inboundTerminated = true;
    rejectHuntWaiter(token, 'destroyed');
  };

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    ariClient.removeListener('StasisEnd', onInboundTerminal);
    ariClient.removeListener('ChannelDestroyed', onInboundTerminal);
    activeHuntTokens.delete(token);
  };

  ariClient.on('StasisEnd', onInboundTerminal);
  ariClient.on('ChannelDestroyed', onInboundTerminal);

  try {
    await ariClient.channels.originate({
      endpoint: destination,
      app: appName,
      appArgs: `hunt-outbound,${token}`,
      callerId,
      timeout: Math.max(1, Math.ceil(timeoutMs / 1000)),
      channelId: attemptChannelId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent('HuntOriginateException', { destination, error: message });
    rejectHuntWaiter(token, 'failed');
    cleanup();
    return {
      status: inboundTerminated ? 'hangup' : 'failed',
      channel: null,
      attemptChannelId,
    };
  }

  timeoutHandle = setTimeout(() => {
    timedOut = true;
    rejectHuntWaiter(token, 'failed');
  }, timeoutMs);

  const result = await waiter;
  cleanup();
  if (inboundTerminated) {
    return {
      status: 'hangup',
      channel: null,
      attemptChannelId,
    };
  }

  if (result.answered) {
    return {
      status: 'answered',
      channel: result.channel,
      attemptChannelId,
    };
  }

  return {
    status: timedOut ? 'timeout' : 'failed',
    channel: null,
    attemptChannelId,
  };
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

async function hangupAttemptChannel(ariClient: AriLike, channelId: string): Promise<void> {
  try {
    await ariClient.channels.hangup({ channelId });
  } catch {
    // Channel might already be gone.
  }
}

interface HuntDestinationConfig {
  target_type: 'extension' | 'pstn';
  target_value: string;
  trunk_id?: number;
}

function normalizeDestinations(config: Record<string, unknown>): HuntDestinationConfig[] {
  if (!Array.isArray(config.destinations)) {
    return [];
  }

  return config.destinations
    .map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
      }
      const item = value as Record<string, unknown>;
      const targetType = item.target_type === 'pstn' ? 'pstn' : item.target_type === 'extension' ? 'extension' : '';
      const targetValue = String(item.target_value || '').trim();
      if (!targetType || !targetValue) return null;
      return {
        target_type: targetType,
        target_value: targetValue,
        trunk_id: item.trunk_id ? Number(item.trunk_id) : undefined,
      } as HuntDestinationConfig;
    })
    .filter((value): value is HuntDestinationConfig => Boolean(value));
}

function nextRandomDestination(destinations: HuntDestinationConfig[], lastDestination: HuntDestinationConfig | null): HuntDestinationConfig {
  if (destinations.length === 0) {
    return { target_type: 'extension', target_value: '' };
  }
  if (destinations.length <= 1) {
    return destinations[0];
  }

  const options = destinations.filter((destination) =>
    !lastDestination
      || destination.target_type !== lastDestination.target_type
      || destination.target_value !== lastDestination.target_value,
  );
  return options[Math.floor(Math.random() * options.length)] || destinations[0];
}

function noAnswerResult(config: Record<string, unknown>): string {
  const nodeKey = String(config.on_no_answer || '').trim();
  return nodeKey ? `route:${nodeKey}` : 'hangup';
}

async function fetchContactNumber(contactId: number): Promise<{ number: string; trunkId: number | null } | null> {
  try {
    const res = await fetch(`http://localhost:3001/contact-numbers/${contactId}`);
    if (!res.ok) {
      return null;
    }
    const payload = await res.json() as { data?: { number?: string; trunkId?: number | null }; number?: string; trunkId?: number | null };
    const contact = payload?.data || payload;
    return {
      number: String(contact?.number || '').trim(),
      trunkId: contact?.trunkId === null || contact?.trunkId === undefined ? null : Number(contact.trunkId),
    };
  } catch {
    return null;
  }
}

async function fetchContactNumberByPhone(
  phoneNumber: string,
): Promise<{ number: string; trunkId: number | null } | null> {
  try {
    const url = new URL('http://localhost:3001/contact-numbers');
    url.searchParams.set('page', '1');
    url.searchParams.set('limit', '1000');
    const res = await fetch(url.toString());
    if (!res.ok) {
      return null;
    }
    const payload = await res.json() as {
      data?: Array<{ number?: string; trunkId?: number | null }>;
    };
    const contact = (payload.data || []).find((item) =>
      String(item.number || '').trim() === phoneNumber,
    );
    if (!contact) {
      return null;
    }
    return {
      number: String(contact.number || '').trim(),
      trunkId: contact.trunkId === null || contact.trunkId === undefined
        ? null
        : Number(contact.trunkId),
    };
  } catch {
    return null;
  }
}

const DEV_FALLBACK_COUNTRY: CountryCode = 'LK';
const PSTN_TARGET_PATTERN = /^\+?[0-9]{4,20}$/;

function normalizeDialNumber(rawNumber: string): string {
  let dialNumber = String(rawNumber || '').trim();

  try {
    let parsed: ReturnType<typeof parsePhoneNumber> | undefined;
    try {
      parsed = parsePhoneNumber(dialNumber);
    } catch {
      // TODO: derive default country from contact's trunk region/provider metadata instead of hardcoded fallback.
      parsed = parsePhoneNumber(dialNumber, DEV_FALLBACK_COUNTRY);
    }

    if (parsed && parsed.isValid()) {
      dialNumber = parsed.format('E.164');
    } else {
      logEvent('HuntNumberNormalizeFailed', { number: dialNumber });
    }
  } catch {
    logEvent('HuntNumberParseFailed', { number: dialNumber });
  }

  return dialNumber;
}

async function resolveHuntDialString(destination: HuntDestinationConfig): Promise<string> {
  if (destination.target_type === 'extension') {
    return `PJSIP/${destination.target_value}`;
  }

  if (destination.target_type === 'pstn') {
    if (destination.trunk_id && PSTN_TARGET_PATTERN.test(destination.target_value)) {
      const dialNumber = normalizeDialNumber(destination.target_value);
      return `PJSIP/${dialNumber}@trunk-${destination.trunk_id}`;
    }

    if (PSTN_TARGET_PATTERN.test(destination.target_value)) {
      const contactByNumber = await fetchContactNumberByPhone(destination.target_value);
      if (contactByNumber?.trunkId) {
        const dialNumber = normalizeDialNumber(contactByNumber.number);
        return `PJSIP/${dialNumber}@trunk-${contactByNumber.trunkId}`;
      }
    }

    // Legacy fallback: target_value as contact id.
    const contactId = parseInt(destination.target_value, 10);
    if (isNaN(contactId)) {
      logEvent('HuntInvalidContactTarget', { targetValue: destination.target_value });
      return '';
    }

    const contact = await fetchContactNumber(contactId);
    if (!contact) {
      logEvent('HuntContactNotFound', { contactId });
      return '';
    }

    if (!contact.trunkId) {
      logEvent('HuntContactMissingTrunk', { contactId });
      return '';
    }

    const dialNumber = normalizeDialNumber(contact.number);
    return `PJSIP/${dialNumber}@trunk-${contact.trunkId}`;
  }

  return '';
}

async function resolveDestinations(destinations: HuntDestinationConfig[]): Promise<Array<{ raw: HuntDestinationConfig; dial: string }>> {
  const resolved = await Promise.all(
    destinations.map(async (raw) => ({ raw, dial: await resolveHuntDialString(raw) })),
  );
  return resolved.filter((item) => Boolean(item.dial));
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
  const destinationConfigs = normalizeDestinations(node.config);
  const destinations = await resolveDestinations(destinationConfigs);
  const strategy = String(node.config.strategy || 'sequential').trim().toLowerCase();
  const attemptTimeoutMs = Math.max(1, Number(node.config.attempt_timeout_ms) || 20000);
  const totalTimeoutMs = Math.max(1, Number(node.config.total_timeout_ms) || 60000);
  const startTime = Date.now();
  let lastDestination: HuntDestinationConfig | null = null;
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
    logEvent('HuntMissingBridgeOrDestinations', { channelId: channel.id, bridgeId: bridgeId || null, destinationCount: destinations.length });
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
    logEvent('HuntHoldStarted', { channelId: channel.id, media: holdMedia });
    holdLoop = startHoldLoop(client, bridgeId, channel.id, holdMedia);
  };

  const stopHold = async () => {
    if (!holdLoop) {
      return;
    }
    await holdLoop.stop();
    holdLoop = null;
    logEvent('HuntHoldStopped', { channelId: channel.id });
  };

  const finalizeAnswer = async (answeredChannel: HuntExecutorChannel): Promise<string> => {
    await stopHold();
    await hangupChannels(pendingChannels, answeredChannel.id);
    pendingChannels = [answeredChannel];
    logEvent('HuntAnsweredBridgeAdd', { inboundChannelId: channel.id, outboundChannelId: answeredChannel.id, bridgeId });
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
          logEvent('HuntGroupOriginate', { destination: destination.dial, timeoutMs: totalTimeoutMs });
          return await captureOriginatedChannel(client, destination.dial, channel.id, session.callerNumber, totalTimeoutMs);
        }),
      );

      pendingChannels = createResults
        .flatMap((result) => (result.status === 'fulfilled' && result.value.channel ? [result.value.channel] : []));

      if (pendingChannels.length === 0) {
        await stopHold();
        return noAnswerResult(node.config);
      }

      const alreadyAnswered = pendingChannels.find((item) => String(item.state || '').toLowerCase() === 'up');
      if (alreadyAnswered) {
        logEvent('HuntGroupLegAlreadyUp', { channelId: alreadyAnswered.id });
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
          logEvent('HuntGroupAnswered', { channelId: answered.id });
          return await finalizeAnswer(answered);
        }
      }

      await stopHold();
      await hangupChannels(pendingChannels);
      pendingChannels = [];
      logEvent('HuntGroupExhausted', { result: 'no-answer' });
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

      const destinationEntry = strategy === 'random'
        ? nextRandomDestination(destinationConfigs, lastDestination)
        : destinationConfigs[sequentialIndex % destinationConfigs.length] || { target_type: 'extension', target_value: '' };
      sequentialIndex += 1;
      lastDestination = destinationEntry;
      const destination = destinations.find((item) => item.raw.target_type === destinationEntry.target_type && item.raw.target_value === destinationEntry.target_value)?.dial || '';
      if (!destination) {
        continue;
      }
      const dialTimeoutMs = Math.min(attemptTimeoutMs, remainingMs);

      startHold();
      logEvent('HuntDialing', { strategy, destination, attemptTimeoutMs: dialTimeoutMs, remainingMs });

      let attemptResult: HuntAttemptResult | null = null;
      try {
        attemptResult = await captureOriginatedChannel(client, destination, channel.id, session.callerNumber, dialTimeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logEvent('HuntAttemptFailed', { destination, error: message });
        attemptResult = null;
      }

      if (!attemptResult || !attemptResult.channel || attemptResult.status !== 'answered') {
        const attemptChannelId = attemptResult?.attemptChannelId;
        await stopHold();
        if (attemptChannelId) {
          await hangupAttemptChannel(client, attemptChannelId);
        }
        if (attemptResult?.status === 'hangup' || inboundEnded) {
          return 'hangup';
        }
        logEvent('HuntOriginateFailed', { destination });
      } else {
        pendingChannels = [attemptResult.channel];
        logEvent('HuntOutboundLegEntered', { destination, channelId: attemptResult.channel.id, state: String(attemptResult.channel.state || 'unknown') });
        // In this call flow, outbound legs only enter the hunt-outbound Stasis app once the
        // destination has effectively answered. Bridge immediately to avoid missing late/absent
        // ChannelStateChange events and trapping caller on hold.
        return await finalizeAnswer(attemptResult.channel);
      }

      const remainingAfterAttempt = totalTimeoutMs - (Date.now() - startTime);
      if (remainingAfterAttempt <= 0) {
        break;
      }
      if (inboundEnded) {
        return 'hangup';
      }

      if (busyMedia) {
        logEvent('HuntBusyMedia', { media: busyMedia });
        await playOnceOnBridge(client, bridgeId, channel.id, busyMedia);
      }
    }

    await stopHold();
    await hangupChannels(pendingChannels);
    pendingChannels = [];
    logEvent('HuntExhausted', { result: noAnswerResult(node.config) });
    return noAnswerResult(node.config);
  } catch (error) {
    await stopHold();
    await hangupChannels(pendingChannels);
    pendingChannels = [];
    const message = error instanceof Error ? error.message : String(error);
    if (inboundEnded || message === 'hangup') {
      return 'hangup';
    }
    logEvent('HuntFatalError', { error: message, result: noAnswerResult(node.config) });
    return noAnswerResult(node.config);
  } finally {
    client.removeListener('StasisEnd', onInboundTerminal);
    client.removeListener('ChannelDestroyed', onInboundTerminal);
  }
}
