export interface DirectOutboundChannel {
  id: string;
  hangup: () => Promise<void>;
}

export type DirectOutboundWaiterResult =
  | { answered: true; channel: DirectOutboundChannel }
  | {
      answered: false;
      reason: DirectOutboundFailureReason;
      detail?: string;
    };

export type DirectOutboundFailureReason = 'failed' | 'destroyed' | 'timeout' | 'caller_disconnected';

interface DirectOutboundWaiter {
  resolve: (result: DirectOutboundWaiterResult) => void;
}

const waiters = new Map<string, DirectOutboundWaiter>();

export function hasDirectOutboundWaiter(token: string): boolean {
  return waiters.has(token);
}

export function registerDirectOutboundWaiter(token: string): Promise<DirectOutboundWaiterResult> {
  return new Promise((resolve) => {
    waiters.set(token, { resolve });
  });
}

export function resolveDirectOutboundWaiter(token: string, channel: DirectOutboundChannel): void {
  const waiter = waiters.get(token);
  if (!waiter) {
    return;
  }
  waiters.delete(token);
  waiter.resolve({ answered: true, channel });
}

export function rejectDirectOutboundWaiter(
  token: string,
  reason: DirectOutboundFailureReason = 'failed',
  detail?: string,
): void {
  const waiter = waiters.get(token);
  if (!waiter) {
    return;
  }
  waiters.delete(token);
  waiter.resolve({ answered: false, reason, ...(detail ? { detail } : {}) });
}
