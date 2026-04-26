import { stasisLogger } from "../logger";
import { resolveAudioMediaPath } from '../audioResolver';
import { CallSession } from '../callSession';
import { query } from '../db';
import { FlowNode } from '../flowLoader';
import { publish } from '../redis';
import { resolveNodeTimeoutMs } from '../timeoutResolver';

interface CallbackNodeConfig {
  number_source?: 'ani' | 'dtmf';
  dtmf_prompt_audio_id?: number | null;
  dtmf_max_digits?: number;
  timeout_ms?: number | null;
  confirmation_audio_id?: number | null;
  operator_id?: number | null;
  destination_type?: 'extension' | 'pstn' | 'operator' | 'caller';
  destination_value?: string | null;
  destination_trunk_id?: number | null;
}

interface CallbackCreatedPayload {
  flowId: number | null;
  trunkId: number | null;
  customerNumber: string | null;
  operatorId: number | null;
  destinationType?: 'extension' | 'pstn';
  destinationValue?: string | null;
  destinationTrunkId?: number | null;
  callLogId: number | null;
  failReason?: 'caller_hangup' | 'dtmf_timeout' | 'executor_error';
}

function waitForPlaybackFinished(
  ariClient: unknown,
  playbackId: string,
  channelId: string,
): Promise<void> {
  const client = ariClient as {
    on: (
      event: string,
      listener: (event: {
        playback?: { id?: string };
        channel?: { id?: string };
      }) => void,
    ) => void;
    removeListener: (
      event: string,
      listener: (event: {
        playback?: { id?: string };
        channel?: { id?: string };
      }) => void,
    ) => void;
  };

  return new Promise((resolve, reject) => {
    const onFinished = (event: { playback?: { id?: string } }) => {
      if (event.playback?.id === playbackId) {
        cleanup();
        resolve();
      }
    };

    const onHangup = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id === channelId) {
        cleanup();
        reject(new Error('hangup'));
      }
    };

    const cleanup = () => {
      client.removeListener('PlaybackFinished', onFinished);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
    };

    client.on('PlaybackFinished', onFinished);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);
  });
}

async function playAudioIfPresent(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void> },
  nodeConfig: Record<string, unknown>,
  audioIdField: string,
  pathField: string,
  ariClient: unknown,
): Promise<void> {
  const audioPath = await resolveAudioMediaPath(nodeConfig, audioIdField, pathField);
  if (!audioPath) {
    return;
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  await channel.play({ media: `sound:${audioPath}` }, playback);
  await waitForPlaybackFinished(ariClient, playback.id, channel.id);
}

function collectDtmfDigits(
  channel: {
    id: string;
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  },
  ariClient: unknown,
  maxDigits: number,
  timeoutMs: number,
  options?: { onFirstDigit?: (digit: string, accumulated: string) => void },
): Promise<{ number: string | null; reason: 'digits' | 'timeout' | 'hangup' }> {
  const client = ariClient as {
    on: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  };

  return new Promise((resolve) => {
    let settled = false;
    let digits = '';
    let firstDigitSeen = false;
    const useChannelEmitter = typeof channel.on === 'function' && typeof channel.removeListener === 'function';

    const cleanup = () => {
      if (useChannelEmitter) {
        channel.removeListener?.('ChannelDtmfReceived', onDtmf);
      } else {
        client.removeListener('ChannelDtmfReceived', onDtmf);
      }
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
      clearTimeout(timer);
    };

    const finish = (result: { number: string | null; reason: 'digits' | 'timeout' | 'hangup' }) => {
      if (settled) return;
      settled = true;
      stasisLogger.log(
        `[callback][dtmf] finalize channel=${channel.id} reason=${result.reason} number=${result.number || ''}`,
      );
      cleanup();
      resolve(result);
    };

    const onDtmf = (event: { channel?: { id?: string }; digit?: string }) => {
      if (event.channel?.id && event.channel.id !== channel.id) {
        return;
      }
      const digit = String(event.digit || '').trim();
      if (!digit) {
        return;
      }
      digits += digit;
      if (!firstDigitSeen) {
        firstDigitSeen = true;
        options?.onFirstDigit?.(digit, digits);
      }
      stasisLogger.log(
        `[callback][dtmf] input channel=${channel.id} digit=${digit} accumulated=${digits}`,
      );
      if (digits.length >= maxDigits) {
        finish({ number: digits.slice(0, maxDigits), reason: 'digits' });
      }
    };

    const onHangup = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) {
        return;
      }
      finish({ number: null, reason: 'hangup' });
    };

    const timer = setTimeout(() => {
      stasisLogger.log(
        `[callback][dtmf] timeout channel=${channel.id} accumulated=${digits}`,
      );
      finish({ number: digits.length > 0 ? digits : null, reason: 'timeout' });
    }, timeoutMs);

    if (useChannelEmitter) {
      channel.on?.('ChannelDtmfReceived', onDtmf);
    } else {
      client.on('ChannelDtmfReceived', onDtmf);
    }
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);
  });
}

async function resolveCallLogId(callUuid: string): Promise<number | null> {
  const rows = await query(
    `
      SELECT id
      FROM call_logs
      WHERE call_uuid = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [callUuid],
  );

  const id = Number(rows[0]?.id || 0);
  return id > 0 ? id : null;
}

async function publishCreated(payload: CallbackCreatedPayload): Promise<void> {
  await publish('callback:created', payload);
}

async function resolveOperatorIdFromExtension(extension: string | null): Promise<number | null> {
  const lookup = String(extension || '').trim();
  if (!lookup) {
    return null;
  }
  const rows = await query(
    `
      SELECT o.id
      FROM operators o
      JOIN sip_extensions e ON e.id = o.extension_id
      WHERE e.username = $1 OR e.id::text = $1
      ORDER BY
        CASE WHEN e.username = $1 THEN 0 ELSE 1 END,
        o.id ASC
      LIMIT 1
    `,
    [lookup],
  );
  const operatorId = Number(rows[0]?.id || 0);
  return operatorId > 0 ? operatorId : null;
}

async function resolveOperatorIdFromDestination(
  destinationType: 'pstn' | 'extension',
  destinationValue: string,
  configOperatorId: number | null,
): Promise<number | null> {
  if (configOperatorId && Number.isInteger(configOperatorId) && configOperatorId > 0) {
    return configOperatorId;
  }

  if (destinationType !== 'extension') {
    return null;
  }

  return resolveOperatorIdFromExtension(destinationValue);
}

export async function executeCallbackNode(
  channel: {
    id: string;
    caller?: { number?: string };
    play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void>;
    hangup: () => Promise<void>;
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<'done'> {
  const config = (node.config || {}) as CallbackNodeConfig;
  const numberSource = config.number_source === 'dtmf' ? 'dtmf' : 'ani';
  const destinationType =
    config.destination_type === 'pstn' || config.destination_type === 'caller'
      ? 'pstn'
      : 'extension';
  const destinationValue = String(config.destination_value || '').trim();
  const destinationTrunkId = config.destination_trunk_id ? Number(config.destination_trunk_id) : null;
  const configOperatorId = config.operator_id ? Number(config.operator_id) : null;
  const operatorId = await resolveOperatorIdFromDestination(destinationType, destinationValue, configOperatorId);
  const flowId = session.flow?.id ? Number(session.flow.id) : null;
  const callLogId = await resolveCallLogId(session.callUuid);

  let customerNumber: string | null = null;
  let customerTrunkId: number | null = null;
  let published = false;

  try {
    if (numberSource === 'ani') {
      const rawCaller = channel.caller?.number;
      const rawSessionCaller = session.callerNumber;
      const ani = typeof rawCaller === 'string' && rawCaller.trim()
        ? rawCaller.trim()
        : String(rawSessionCaller || '').trim();
      customerNumber = ani || null;
    } else {
      const dtmfPromptPath = await resolveAudioMediaPath(
        node.config as Record<string, unknown>,
        'dtmf_prompt_audio_id',
        'dtmf_prompt_audio_path',
      );
      const playbackFactory = ariClient as { Playback?: () => { id: string; stop?: () => Promise<void> } };
      const dtmfPromptPlayback = dtmfPromptPath && typeof playbackFactory.Playback === 'function'
        ? playbackFactory.Playback()
        : null;
      if (dtmfPromptPath && dtmfPromptPlayback) {
        await channel.play({ media: `sound:${dtmfPromptPath}` }, dtmfPromptPlayback);
      }

      const maxDigitsRaw = parseInt(String(config.dtmf_max_digits ?? 11), 10);
      const maxDigits = Number.isInteger(maxDigitsRaw) && maxDigitsRaw > 0 ? maxDigitsRaw : 11;
      const timeoutMs = resolveNodeTimeoutMs(node, session, 20_000);
      let promptStopped = false;
      const stopPromptPlayback = async (reason: 'first_digit' | 'collection_done') => {
        if (promptStopped || !dtmfPromptPlayback?.stop) {
          return;
        }
        promptStopped = true;
        stasisLogger.log(`[callback][dtmf] stopping_prompt channel=${channel.id} reason=${reason}`);
        await dtmfPromptPlayback.stop().catch(() => undefined);
      };
      stasisLogger.log(
        `[callback][dtmf] collecting channel=${channel.id} max_digits=${maxDigits} timeout_ms=${timeoutMs}`,
      );
      const dtmfResult = await collectDtmfDigits(channel, ariClient, maxDigits, timeoutMs, {
        onFirstDigit: () => {
          void stopPromptPlayback('first_digit');
        },
      });
      await stopPromptPlayback('collection_done');

      if (dtmfResult.reason === 'hangup') {
        throw new Error('caller_hangup');
      }

      if (dtmfResult.reason === 'timeout' && !dtmfResult.number) {
        await publishCreated({
          flowId,
          trunkId: customerTrunkId,
          customerNumber: null,
          operatorId,
          destinationType,
          destinationValue: destinationValue || null,
          destinationTrunkId,
          callLogId,
          failReason: 'dtmf_timeout',
        });
        published = true;
      } else {
        customerNumber = dtmfResult.number;
      }
    }

    if (!published) {
      if (!customerNumber && destinationType === 'pstn' && destinationValue) {
        customerNumber = destinationValue;
      }
      if (!customerTrunkId && destinationType === 'pstn') {
        customerTrunkId = destinationTrunkId;
      }
      await publishCreated({
        flowId,
        trunkId: customerTrunkId,
        customerNumber,
        operatorId,
        destinationType,
        destinationValue: destinationValue || null,
        destinationTrunkId,
        callLogId,
      });
      published = true;
    }

    await playAudioIfPresent(
      channel,
      node.config,
      'confirmation_audio_id',
      'confirmation_audio_path',
      ariClient,
    );

    await channel.hangup().catch(() => undefined);
    return 'done';
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const failReason: 'caller_hangup' | 'dtmf_timeout' | 'executor_error' =
      message === 'caller_hangup' || message === 'hangup'
        ? 'caller_hangup'
        : (numberSource === 'dtmf' && message === 'dtmf_timeout')
          ? 'dtmf_timeout'
          : 'executor_error';

    if (!published) {
      await publishCreated({
        flowId,
        trunkId: customerTrunkId,
        customerNumber: null,
        operatorId,
        destinationType,
        destinationValue: destinationValue || null,
        destinationTrunkId,
        callLogId,
        failReason,
      });
    }

    await channel.hangup().catch(() => undefined);
    return 'done';
  }
}
