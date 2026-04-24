export interface TransferChannel {
  id: string;
  hangup: () => Promise<void>;
}

export type TransferWaiterResult =
  | { answered: true; channel: TransferChannel }
  | {
      answered: false;
      reason: 'failed' | 'destroyed' | 'timeout' | 'caller_disconnected';
    };

interface TransferWaiter {
  resolve: (result: TransferWaiterResult) => void;
}

const waiters = new Map<string, TransferWaiter>();

export function registerTransferWaiter(inboundChannelId: string): Promise<TransferWaiterResult> {
  return new Promise((resolve) => {
    waiters.set(inboundChannelId, { resolve });
  });
}

export function resolveTransferWaiter(inboundChannelId: string, channel: TransferChannel): void {
  const waiter = waiters.get(inboundChannelId);
  if (!waiter) return;
  waiters.delete(inboundChannelId);
  waiter.resolve({ answered: true, channel });
}

export function rejectTransferWaiter(
  inboundChannelId: string,
  reason: 'failed' | 'destroyed' | 'timeout' | 'caller_disconnected' = 'failed',
): void {
  const waiter = waiters.get(inboundChannelId);
  if (!waiter) return;
  waiters.delete(inboundChannelId);
  waiter.resolve({ answered: false, reason });
}
