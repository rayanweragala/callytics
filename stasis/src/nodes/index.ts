import { FlowNode } from '../flowLoader';
import { CallSession } from '../callSession';

function waitForPlaybackFinished(
  ariClient: any,
  playbackId: string,
  channelId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinished = (event: any) => {
      if (event?.playback?.id === playbackId) {
        cleanup();
        resolve();
      }
    };

    const onHangup = (event: any) => {
      if (event?.channel?.id === channelId) {
        cleanup();
        reject(new Error('hangup'));
      }
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

async function executeStart(): Promise<string> {
  return 'default';
}

async function executePlayAudio(
  channel: any,
  node: FlowNode,
  _session: CallSession,
  ariClient: any,
): Promise<string> {
  const audioFilePath = node.config?.audio_file_path;

  if (!audioFilePath) {
    return 'default';
  }

  try {
    const playback = ariClient.Playback();
    await channel.play({ media: 'sound:' + audioFilePath }, playback);
    await waitForPlaybackFinished(ariClient, playback.id, channel.id);
    return 'default';
  } catch (error) {
    console.error('play_audio failed:', error);
    return 'hangup';
  }
}

async function executeGetDigits(
  channel: any,
  node: FlowNode,
  _session: CallSession,
  ariClient: any,
): Promise<string> {
  const promptPath = node.config?.prompt_path;
  const timeoutMs = Number(node.config?.timeout_ms) || 5000;

  return new Promise(async (resolve) => {
    const playback = ariClient.Playback();
    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      ariClient.removeListener('ChannelDtmfReceived', onDtmf);
      ariClient.removeListener('StasisEnd', onHangup);
      ariClient.removeListener('ChannelDestroyed', onHangup);
      if (timer) {
        clearTimeout(timer);
      }
    };

    const settle = async (value: string) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      try {
        await playback.stop();
      } catch (_) {}
      resolve(value);
    };

    const onDtmf = async (event: any) => {
      if (event?.channel?.id !== channel.id) {
        return;
      }
      await settle(String(event?.digit ?? 'default'));
    };

    const onHangup = async (event: any) => {
      if (event?.channel?.id !== channel.id) {
        return;
      }
      await settle('hangup');
    };

    ariClient.on('ChannelDtmfReceived', onDtmf);
    ariClient.on('StasisEnd', onHangup);
    ariClient.on('ChannelDestroyed', onHangup);

    timer = setTimeout(async () => {
      await settle('timeout');
    }, timeoutMs);

    try {
      if (promptPath) {
        await channel.play({ media: 'sound:' + promptPath }, playback);
      }
    } catch (error) {
      console.error('get_digits failed:', error);
      await settle('hangup');
    }
  });
}

async function executeBranch(): Promise<string> {
  return 'default';
}

async function executeTransfer(_channel: any, node: FlowNode): Promise<string> {
  console.log('transfer: not yet implemented for target: ' + node.config?.target);
  return 'default';
}

async function executeVoicemail(_channel: any, node: FlowNode): Promise<string> {
  console.log('voicemail: not yet implemented for mailbox: ' + node.config?.mailbox);
  return 'default';
}

async function executeHangup(channel: any): Promise<string> {
  try {
    await channel.hangup();
  } catch (_) {}
  return 'done';
}

async function executeSetVariable(_channel: any, node: FlowNode, session: CallSession): Promise<string> {
  const variableName = node.config?.variable_name;
  const variableValue = node.config?.variable_value;

  if (variableName) {
    session.variables[String(variableName)] = String(variableValue ?? '');
  }

  return 'default';
}

export async function executeNode(
  channel: any,
  node: FlowNode,
  session: CallSession,
  ariClient: any,
): Promise<string> {
  switch (node.type) {
    case 'start':
      return executeStart();
    case 'play_audio':
      return executePlayAudio(channel, node, session, ariClient);
    case 'get_digits':
      return executeGetDigits(channel, node, session, ariClient);
    case 'branch':
      return executeBranch();
    case 'transfer':
      return executeTransfer(channel, node);
    case 'voicemail':
      return executeVoicemail(channel, node);
    case 'hangup':
      return executeHangup(channel);
    case 'set_variable':
      return executeSetVariable(channel, node, session);
    default:
      console.warn(`Unknown node type: ${node.type}`);
      return 'default';
  }
}
