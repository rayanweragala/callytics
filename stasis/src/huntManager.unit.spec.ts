import { registerHuntWaiter, resolveHuntWaiter, rejectHuntWaiter, HuntOutboundChannel } from './huntManager';

describe('huntManager', () => {
  it('registering a waiter returns a Promise', () => {
    const p = registerHuntWaiter('tok1');
    expect(p).toBeInstanceOf(Promise);
  });

  it('resolving with a matching key resolves the Promise with the correct value', async () => {
    const p = registerHuntWaiter('tok2');
    const mockChannel = { id: 'c2', hangup: jest.fn() } as HuntOutboundChannel;
    resolveHuntWaiter('tok2', mockChannel);
    await expect(p).resolves.toBe(mockChannel);
  });

  it('resolving with a non-matching key does not affect other waiters', async () => {
    const p = registerHuntWaiter('tok3');
    resolveHuntWaiter('tok-other', { id: 'other', hangup: jest.fn() } as HuntOutboundChannel);
    
    rejectHuntWaiter('tok3', new Error('cleanup'));
    await expect(p).rejects.toThrow('cleanup');
  });

  it('registering a duplicate key overwrites the previous waiter', async () => {
    const p1 = registerHuntWaiter('tok4');
    const p2 = registerHuntWaiter('tok4');
    
    const mockChannel = { id: 'c4', hangup: jest.fn() } as HuntOutboundChannel;
    resolveHuntWaiter('tok4', mockChannel);
    
    await expect(p2).resolves.toBe(mockChannel);
  });
});
