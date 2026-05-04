export interface CallbackChannel {
  id: string;
  hangup: () => Promise<void>;
}

export type CallbackWaiterResult =
  | { answered: true; channel: CallbackChannel }
  | { answered: false; reason: 'failed' | 'destroyed' | 'timeout' };

interface CallbackWaiter {
  resolve: (result: CallbackWaiterResult) => void;
}

const waiters = new Map<string, CallbackWaiter>();

function key(callbackId: number, leg: 'operator' | 'customer'): string {
  return `${callbackId}:${leg}`;
}

export function hasCallbackWaiter(callbackId: number, leg: 'operator' | 'customer'): boolean {
  return waiters.has(key(callbackId, leg));
}

export function registerCallbackWaiter(callbackId: number, leg: 'operator' | 'customer'): Promise<CallbackWaiterResult> {
  return new Promise((resolve) => {
    waiters.set(key(callbackId, leg), { resolve });
  });
}

export function resolveCallbackWaiter(callbackId: number, leg: 'operator' | 'customer', channel: CallbackChannel): void {
  const waiter = waiters.get(key(callbackId, leg));
  if (!waiter) return;
  waiters.delete(key(callbackId, leg));
  waiter.resolve({ answered: true, channel });
}

export function rejectCallbackWaiter(
  callbackId: number,
  leg: 'operator' | 'customer',
  reason: 'failed' | 'destroyed' | 'timeout' = 'failed',
): void {
  const waiter = waiters.get(key(callbackId, leg));
  if (!waiter) return;
  waiters.delete(key(callbackId, leg));
  waiter.resolve({ answered: false, reason });
}
