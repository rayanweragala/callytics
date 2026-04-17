import { registerTransferWaiter, resolveTransferWaiter, rejectTransferWaiter, TransferChannel } from './transferManager';

describe('transferManager', () => {
  it('registering a waiter returns a Promise', () => {
    const p = registerTransferWaiter('chan1');
    expect(p).toBeInstanceOf(Promise);
  });

  it('resolving with a matching key resolves the Promise with the correct value', async () => {
    const p = registerTransferWaiter('chan2');
    const mockChannel = { id: 'c2', hangup: jest.fn() } as TransferChannel;
    resolveTransferWaiter('chan2', mockChannel);
    await expect(p).resolves.toBe(mockChannel);
  });

  it('resolving with a non-matching key does not affect other waiters', async () => {
    const p = registerTransferWaiter('chan3');
    resolveTransferWaiter('chan-other', { id: 'other', hangup: jest.fn() } as TransferChannel);
    
    // Resolve naturally or reject to close the test
    rejectTransferWaiter('chan3', new Error('cleanup'));
    await expect(p).rejects.toThrow('cleanup');
  });

  it('registering a duplicate key overwrites the previous waiter', async () => {
    const p1 = registerTransferWaiter('chan4'); // Orphaned
    const p2 = registerTransferWaiter('chan4');
    
    const mockChannel = { id: 'c4', hangup: jest.fn() } as TransferChannel;
    resolveTransferWaiter('chan4', mockChannel);
    
    await expect(p2).resolves.toBe(mockChannel);
  });
});
