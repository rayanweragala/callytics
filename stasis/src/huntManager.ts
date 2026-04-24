export interface HuntOutboundChannel {
  id: string;
  hangup: () => Promise<void>;
  state?: string;
}

export type HuntWaiterResult =
  | { answered: true; channel: HuntOutboundChannel }
  | { answered: false; reason: 'failed' | 'destroyed' };

interface HuntWaiter {
  resolve: (result: HuntWaiterResult) => void;
}

const waiters = new Map<string, HuntWaiter>();

export function hasHuntWaiter(token: string): boolean {
  return waiters.has(token);
}

export function registerHuntWaiter(token: string): Promise<HuntWaiterResult> {
  return new Promise((resolve) => {
    waiters.set(token, { resolve });
  });
}

export function resolveHuntWaiter(token: string, channel: HuntOutboundChannel): void {
  const waiter = waiters.get(token);
  if (!waiter) return;
  waiters.delete(token);
  waiter.resolve({ answered: true, channel });
}

export function rejectHuntWaiter(token: string, reason: 'failed' | 'destroyed' = 'failed'): void {
  const waiter = waiters.get(token);
  if (!waiter) return;
  waiters.delete(token);
  waiter.resolve({ answered: false, reason });
}
