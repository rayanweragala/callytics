import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { resolveAudioMediaPath } from '../audioResolver';
import { publishNodeTelemetry } from '../telemetry';
import { registerTransferWaiter } from '../transferManager';
import { executeHunt } from './hunt.executor';
import { executeMenu } from '../executors/menu.executor';

type PlaybackTarget =
  | { kind: 'channel'; id: string; play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void> }
  | { kind: 'bridge'; id: string };

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

function getPlaybackTarget(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void> },
  session: CallSession,
): PlaybackTarget {
  if (session.inboundBridge) {
    return { kind: 'bridge', id: session.inboundBridge.id };
  }
  return { kind: 'channel', id: channel.id, play: channel.play };
}

async function stopLiveRecording(name: string): Promise<void> {
  const ariUrl = (process.env.ARI_URL || 'http://127.0.0.1:8088').replace(/\/+$/, '');
  const ariUser = process.env.ARI_USER || 'callytics';
  const ariPass = process.env.ARI_PASS || 'callytics';
  const response = await fetch(`${ariUrl}/ari/recordings/live/${encodeURIComponent(name)}/stop`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${ariUser}:${ariPass}`).toString('base64')}`,
    },
  });

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`record_stop_failed status=${response.status} body=${body}`);
  }
}

async function playMedia(
  target: PlaybackTarget,
  ariClient: unknown,
  media: string,
  playback: { id: string; stop?: () => Promise<void> },
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

async function executePlayAudio(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string }) => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  const audioFilePath = await resolveAudioMediaPath(node.config, 'audio_file_id', 'audio_file_path');

  if (!audioFilePath) {
    return 'default';
  }

  const playbackFactory = ariClient as { Playback: () => { id: string } };
  const playback = playbackFactory.Playback();
  const target = getPlaybackTarget(channel as never, session);
  console.log(`[play_audio] request target=${target.kind}:${target.id} media=sound:${audioFilePath} at=${new Date().toISOString()}`);
  await playMedia(target, ariClient, 'sound:' + audioFilePath, playback);
  console.log(`[play_audio] request returned target=${target.kind}:${target.id} media=sound:${audioFilePath} playbackId=${playback.id} at=${new Date().toISOString()}`);
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
  session: CallSession,
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
        const target = getPlaybackTarget(channel as never, session);
        console.log(`[get_digits] play request target=${target.kind}:${target.id} media=sound:${promptPath} at=${new Date().toISOString()}`);
        await playMedia(target, ariClient, 'sound:' + promptPath, playback);
        console.log(`[get_digits] play request returned target=${target.kind}:${target.id} media=sound:${promptPath} playbackId=${playback.id} at=${new Date().toISOString()}`);
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

  if (session.inboundBridge) {
    if (session.recording && !session.recording.endedAt) {
      try {
        await stopLiveRecording(session.recording.name);
      } catch (error) {
        console.error(`[recording] transfer stop failed call_id=${session.callUuid} file=${session.recording.fileName}:`, error);
      }
      session.recording.endedAt = new Date();
    }
    try {
      await client.bridges.destroy({ bridgeId: session.inboundBridge.id });
      console.log(`[bridge] transfer teardown inbound bridge=${session.inboundBridge.id}`);
    } catch (error) {
      console.error(`[bridge] transfer teardown failed bridge=${session.inboundBridge.id}:`, error);
    }
    session.inboundBridge = null;
  }

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

type NodeExecutor = (
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void>; hangup: () => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
) => Promise<string>;

const executorMap: Record<string, NodeExecutor> = {
  start: async () => executeStart(),
  play_audio: executePlayAudio,
  get_digits: executeGetDigits,
  menu: executeMenu,
  branch: async () => executeBranch(),
  transfer: executeTransfer,
  hunt: executeHunt,
  voicemail: async (_channel, node) => executeVoicemail(node),
  hangup: async (channel) => executeHangup(channel),
  set_variable: async (_channel, node, session) => executeSetVariable(node, session),
};

export async function executeNode(
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop?: () => Promise<void> }) => Promise<void>; hangup: () => Promise<void> },
  node: FlowNode,
  session: CallSession,
  ariClient: unknown,
): Promise<string> {
  await publishNodeTelemetry(session, node, 'started');

  try {
    if (node.type === 'group') {
      // visual-only node — never executed at runtime
      return 'default';
    }

    const executor = executorMap[node.type];
    if (!executor) {
      console.warn(`Unknown node type: ${node.type}`);
      await publishNodeTelemetry(session, node, 'completed', { result: 'default' });
      return 'default';
    }

    const result = await executor(channel, node, session, ariClient);
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
