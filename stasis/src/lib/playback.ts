import { logEvent } from '../logger';

interface PlaybackEvent {
  playback?: { id?: string; state?: string; media_uri?: string };
  channel?: { id?: string };
}

export interface PlaybackClient {
  on: (event: string, listener: (event: PlaybackEvent) => void) => void;
  removeListener: (event: string, listener: (event: PlaybackEvent) => void) => void;
  channels?: {
    get?: (params: { channelId: string }) => Promise<unknown>;
  };
}

export const HANGUP_ERROR_MESSAGE = 'hangup';

/** True when an error from a playback or dial wait means the caller is gone. */
export function isHangupError(error: unknown): boolean {
  return error instanceof Error && error.message === HANGUP_ERROR_MESSAGE;
}

async function channelIsAlive(client: PlaybackClient, channelId: string): Promise<boolean> {
  if (!client.channels?.get) {
    return true;
  }
  try {
    await client.channels.get({ channelId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves when the playback finished and rejects with a "hangup" error when
 * the channel disappeared. Asterisk also emits PlaybackFinished with state
 * "failed" when the caller hangs up during playback. That case is treated as a
 * hangup. A failed playback on a channel that is still up (for example a
 * missing sound file) is logged and treated as finished so the flow continues.
 */
export function waitForPlaybackFinished(
  ariClient: unknown,
  playbackId: string,
  channelId: string,
): Promise<void> {
  const client = ariClient as PlaybackClient;

  return new Promise((resolve, reject) => {
    let channelGone = false;

    const cleanup = () => {
      client.removeListener('PlaybackFinished', onFinished);
      client.removeListener('StasisEnd', onHangup);
      client.removeListener('ChannelDestroyed', onHangup);
      client.removeListener('ChannelHangupRequest', onHangup);
    };

    const onFinished = (event: PlaybackEvent) => {
      if (event.playback?.id !== playbackId) {
        return;
      }
      cleanup();
      if (event.playback?.state !== 'failed') {
        resolve();
        return;
      }
      void channelIsAlive(client, channelId).then((alive) => {
        if (channelGone || !alive) {
          reject(new Error(HANGUP_ERROR_MESSAGE));
          return;
        }
        logEvent('PlaybackFailedOnLiveChannel', { channelId, playbackId, media: event.playback?.media_uri ?? null });
        resolve();
      });
    };

    const onHangup = (event: PlaybackEvent) => {
      if (event.channel?.id !== channelId) {
        return;
      }
      channelGone = true;
      cleanup();
      reject(new Error(HANGUP_ERROR_MESSAGE));
    };

    client.on('PlaybackFinished', onFinished);
    client.on('StasisEnd', onHangup);
    client.on('ChannelDestroyed', onHangup);
    client.on('ChannelHangupRequest', onHangup);
  });
}
