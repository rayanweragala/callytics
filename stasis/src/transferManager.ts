interface TransferWaiter {
  resolve: (channel: TransferChannel) => void;
  reject: (error: Error) => void;
}

export interface TransferChannel {
  id: string;
  hangup: () => Promise<void>;
}

const waiters = new Map<string, TransferWaiter>();

export function registerTransferWaiter(inboundChannelId: string): Promise<TransferChannel> {
  return new Promise((resolve, reject) => {
    waiters.set(inboundChannelId, { resolve, reject });
  });
}

export function resolveTransferWaiter(inboundChannelId: string, channel: TransferChannel): void {
  const waiter = waiters.get(inboundChannelId);
  if (!waiter) {
    return;
  }
  waiters.delete(inboundChannelId);
  waiter.resolve(channel);
}

export function rejectTransferWaiter(inboundChannelId: string, error: Error): void {
  const waiter = waiters.get(inboundChannelId);
  if (!waiter) {
    return;
  }
  waiters.delete(inboundChannelId);
  waiter.reject(error);
}
