export interface HuntOutboundChannel {
  id: string;
  hangup: () => Promise<void>;
  state?: string;
}

interface HuntWaiter {
  resolve: (channel: HuntOutboundChannel) => void;
  reject: (error: Error) => void;
}

const waiters = new Map<string, HuntWaiter>();

export function registerHuntWaiter(token: string): Promise<HuntOutboundChannel> {
  return new Promise((resolve, reject) => {
    waiters.set(token, { resolve, reject });
  });
}

export function resolveHuntWaiter(token: string, channel: HuntOutboundChannel): void {
  const waiter = waiters.get(token);
  if (!waiter) {
    return;
  }

  waiters.delete(token);
  waiter.resolve(channel);
}

export function rejectHuntWaiter(token: string, error: Error): void {
  const waiter = waiters.get(token);
  if (!waiter) {
    return;
  }

  waiters.delete(token);
  waiter.reject(error);
}
