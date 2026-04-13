import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { resolveAudioMediaPath } from '../audioResolver';
import { publishNodeTelemetry } from '../telemetry';
import { registerTransferWaiter } from '../transferManager';

async function executeStart(): Promise<string> {
  return 'default';
}

function waitForPlaybackFinished(
  ariClient: unknown,
  playbackId: string,
  channelId: string,
): Promise<void> {
  const client = ariClient as {
    on: (event: string, listener: (event: { playback?: { id?: string }; channel?: { id?: string } }) => void) => void;
    removeListener: (event: string, listener: (event: { playback?: { id?: string }; channel?: { id?: string } }) => void) => void;
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

async function executePlayAudio(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  node: FlowNode,
  ariClient: unknown,
): Promise<string> {
  const audioFilePath = await resolveAudioMediaPath(node.config, 'audio_file_id', 'audio_file_path');

  if (!audioFilePath) {
    return 'default';
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  await channel.play({ media: 'sound:' + audioFilePath }, playback);
  await waitForPlaybackFinished(ariClient, playback.id, channel.id);
  return 'default';
}

async function executeGetDigits(
  channel: {
    id: string;
    play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void>;
    on?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener?: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  },
  node: FlowNode,
  ariClient: unknown,
): Promise<string> {
  console.log(`[get_digits] start channel=${channel.id} config=${JSON.stringify(node.config)}`);
  const promptPath = await resolveAudioMediaPath(node.config, 'prompt_audio_file_id', 'prompt_path');
  const timeoutMs = Number(node.config.timeout_ms) || 5000;
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

    const settle = async (value: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      await stopPlaybackSafely();
      console.log(`[get_digits] returning channel=${channel.id} result=${value}`);
      resolve(value);
    };

    const onDtmf = async (event: { channel?: { id?: string }; digit?: string }) => {
      if (event.channel?.id && event.channel.id !== channel.id) return;
      console.log(`[get_digits] ChannelDtmfReceived channel=${channel.id} digit=${String(event.digit || '')}`);
      await settle(String(event.digit || 'default'));
    };

    const onHangup = async (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) return;
      await settle('hangup');
    };

    console.log(`[get_digits] listening for DTMF on channel=${channel.id}`);
    client.on('ChannelDtmfReceived', onDtmf);
    channelEmitter.on?.('ChannelDtmfReceived', onDtmf);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);

    timer = setTimeout(() => {
      console.log('[get_digits] timeout fired');
      void settle('timeout');
    }, timeoutMs);

    try {
      if (promptPath) {
        await channel.play({ media: 'sound:' + promptPath }, playback);
      }
    } catch (error) {
      reject(error instanceof Error ? error : new Error('get_digits_failed'));
    }
  });
}

async function executeBranch(): Promise<string> {
  return 'default';
}


function waitForChannelEnd(
  ariClient: unknown,
  channelIds: string[],
): Promise<void> {
  const client = ariClient as {
    on: (event: string, listener: (event: { channel?: { id?: string } }) => void) => void;
    removeListener: (event: string, listener: (event: { channel?: { id?: string } }) => void) => void;
  };

  return new Promise((resolve) => {
    const onEnd = (event: { channel?: { id?: string } }) => {
      if (event.channel?.id && channelIds.includes(event.channel.id)) {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      client.removeListener('StasisEnd', onEnd);
      client.removeListener('ChannelDestroyed', onEnd);
    };

    client.on('StasisEnd', onEnd);
    client.on('ChannelDestroyed', onEnd);
  });
}

async function executeTransfer(
  channel: { id: string },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  const destination = String(node.config.destination || '').trim();
  const timeoutMs = Number(node.config.timeout_ms) || 30000;
  const onNoAnswer = String(node.config.on_no_answer || '').trim();

  if (!destination) {
    console.log('transfer: missing destination');
    return 'hangup';
  }

  const client = ariClient as {
    channels: {
      originate: (params: { endpoint: string; app: string; appArgs: string; callerId: string; timeout: number }) => Promise<void>;
    };
    bridges: {
      create: (params: { type: string }) => Promise<{ id: string }>;
      addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
      destroy: (params: { bridgeId: string }) => Promise<void>;
    };
  };

  const waitForAnswer = registerTransferWaiter(channel.id);
  const appName = process.env.ARI_APP || 'callytics';

  try {
    await client.channels.originate({
      endpoint: destination,
      app: appName,
      appArgs: `transfer-outbound,${channel.id}`,
      callerId: session.callerNumber,
      timeout: Math.ceil(timeoutMs / 1000),
    });

    const outboundChannel = await Promise.race([
      waitForAnswer,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (!outboundChannel) {
      console.log(`transfer: no answer for destination ${destination}`);
      return onNoAnswer ? `route:${onNoAnswer}` : 'hangup';
    }

    const bridge = await client.bridges.create({ type: 'mixing' });
    await client.bridges.addChannel({ bridgeId: bridge.id, channel: channel.id });
    await client.bridges.addChannel({ bridgeId: bridge.id, channel: outboundChannel.id });
    await waitForChannelEnd(ariClient, [channel.id, outboundChannel.id]);
    try {
      await client.bridges.destroy({ bridgeId: bridge.id });
    } catch {}
    return 'done';
  } catch (error) {
    console.error('transfer failed:', error);
    return onNoAnswer ? `route:${onNoAnswer}` : 'hangup';
  }
}

async function executeVoicemail(node: FlowNode): Promise<string> {
  console.log('voicemail: not yet implemented for mailbox: ' + String(node.config.mailbox || ''));
  return 'default';
}

async function executeHangup(channel: { hangup: () => Promise<void> }): Promise<string> {
  try {
    await channel.hangup();
  } catch {}
  return 'done';
}

async function executeSetVariable(node: FlowNode, session: CallSession): Promise<string> {
  const variableName = String(node.config.variable_name || '');
  const variableValue = String(node.config.variable_value || '');
  if (variableName) session.variables[variableName] = variableValue;
  return 'default';
}

export async function executeNode(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void>; hangup: () => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  await publishNodeTelemetry(session, node, 'started');

  try {
    let result = 'default';

    switch (node.type) {
      case 'start':
        result = await executeStart();
        break;
      case 'play_audio':
        result = await executePlayAudio(channel, node, ariClient);
        break;
      case 'get_digits':
        result = await executeGetDigits(channel, node, ariClient);
        break;
      case 'branch':
        result = await executeBranch();
        break;
      case 'transfer':
        result = await executeTransfer(channel, node, session, ariClient);
        break;
      case 'voicemail':
        result = await executeVoicemail(node);
        break;
      case 'hangup':
        result = await executeHangup(channel);
        break;
      case 'set_variable':
        result = await executeSetVariable(node, session);
        break;
      default:
        console.warn(`Unknown node type: ${node.type}`);
        result = 'default';
        break;
    }

    await publishNodeTelemetry(session, node, 'completed', { result });
    return result;
  } catch (error) {
    console.error(`Node execution failed for ${node.nodeKey}:`, error);
    await publishNodeTelemetry(session, node, 'error', {
      message: error instanceof Error ? error.message : 'unknown error',
    });
    return 'hangup';
  }
}
