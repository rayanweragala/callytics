import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { resolveAudioMediaPath } from '../audioResolver';
import { publishNodeTelemetry } from '../telemetry';

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
  channel: { id: string; play: (opts: { media: string }, playback: { id: string; stop: () => Promise<void> }) => Promise<void> },
  node: FlowNode,
  ariClient: unknown,
): Promise<string> {
  const promptPath = await resolveAudioMediaPath(node.config, 'prompt_audio_file_id', 'prompt_path');
  const timeoutMs = Number(node.config.timeout_ms) || 5000;
  const client = ariClient as {
    Playback: () => { id: string; stop: () => Promise<void> };
    on: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
    removeListener: (event: string, listener: (event: { channel?: { id?: string }; digit?: string }) => void) => void;
  };

  return new Promise(async (resolve, reject) => {
    const playback = client.Playback();
    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      client.removeListener('ChannelDtmfReceived', onDtmf);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
      if (timer) clearTimeout(timer);
    };

    const settle = async (value: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        await playback.stop();
      } catch {}
      resolve(value);
    };

    const onDtmf = async (event: { channel?: { id?: string }; digit?: string }) => {
      if (event.channel?.id !== channel.id) return;
      await settle(String(event.digit || 'default'));
    };

    const onHangup = async (event: { channel?: { id?: string } }) => {
      if (event.channel?.id !== channel.id) return;
      await settle('hangup');
    };

    client.on('ChannelDtmfReceived', onDtmf);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);

    timer = setTimeout(() => {
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

async function executeTransfer(node: FlowNode): Promise<string> {
  console.log('transfer: not yet implemented for target: ' + String(node.config.target || ''));
  return 'default';
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
        result = await executeTransfer(node);
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
