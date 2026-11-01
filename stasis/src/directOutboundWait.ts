import {
  type DirectOutboundWaiterResult,
  registerDirectOutboundWaiter,
  rejectDirectOutboundWaiter,
} from './directOutboundManager';

interface AriEvent {
  channel?: { id?: string };
  cause?: number;
  cause_txt?: string;
}

export interface DirectOutboundWaitClient {
  on: (event: string, listener: (event: AriEvent) => void) => void;
  removeListener: (event: string, listener: (event: AriEvent) => void) => void;
}

interface WaitLogger {
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

export const DEFAULT_DIRECT_OUTBOUND_TIMEOUT_MS = 30_000;

/** Reads DIRECT_OUTBOUND_TIMEOUT_MS; falls back to the default for missing or invalid values. */
export function resolveDirectOutboundTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1000 ? Math.floor(parsed) : DEFAULT_DIRECT_OUTBOUND_TIMEOUT_MS;
}

function describeCause(event: AriEvent): string {
  const text = event.cause_txt ? String(event.cause_txt) : 'unknown cause';
  return event.cause === undefined ? text : `${text} (cause ${event.cause})`;
}

/**
 * Waits until the originated outbound leg answers (resolved through the
 * "direct-outbound" StasisStart) or fails. Failure is detected when:
 * - originate() throws (reason "failed", with the error message as detail),
 * - the outbound channel is destroyed before it answered (reason "destroyed",
 *   with the Asterisk hangup cause as detail),
 * - the caller hangs up (reason "caller_disconnected"),
 * - the timeout expires (reason "timeout").
 * The outbound channel id is chosen by the caller so it can be watched before
 * originate() returns.
 */
export async function waitForDirectOutboundAnswer(
  ariClient: DirectOutboundWaitClient,
  logger: WaitLogger,
  params: {
    token: string;
    inboundChannelId: string;
    outboundChannelId: string;
    originate: () => Promise<void>;
    timeoutMs: number;
  },
): Promise<DirectOutboundWaiterResult> {
  const { token, inboundChannelId, outboundChannelId, originate, timeoutMs } = params;
  const waiter = registerDirectOutboundWaiter(token);
  let timeoutHandle: NodeJS.Timeout | null = null;

  const onInboundEnd = (event: AriEvent) => {
    if (event.channel?.id === inboundChannelId) {
      rejectDirectOutboundWaiter(token, 'caller_disconnected');
    }
  };

  const onOutboundDestroyed = (event: AriEvent) => {
    if (event.channel?.id !== outboundChannelId) {
      return;
    }
    const detail = describeCause(event);
    logger.warn(
      `[direct-outbound] outbound leg ${outboundChannelId} ended before answer: ${detail}`,
    );
    rejectDirectOutboundWaiter(token, 'destroyed', detail);
  };

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    ariClient.removeListener('StasisEnd', onInboundEnd);
    ariClient.removeListener('ChannelDestroyed', onInboundEnd);
    ariClient.removeListener('ChannelDestroyed', onOutboundDestroyed);
  };

  ariClient.on('StasisEnd', onInboundEnd);
  ariClient.on('ChannelDestroyed', onInboundEnd);
  ariClient.on('ChannelDestroyed', onOutboundDestroyed);

  try {
    await originate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[direct-outbound] originate failed: ${message}`, error);
    rejectDirectOutboundWaiter(token, 'failed', `originate failed: ${message}`);
  }

  timeoutHandle = setTimeout(() => {
    logger.warn(`[direct-outbound] no answer from ${outboundChannelId} after ${timeoutMs}ms`);
    rejectDirectOutboundWaiter(token, 'timeout');
  }, timeoutMs);

  try {
    return await waiter;
  } finally {
    cleanup();
  }
}
