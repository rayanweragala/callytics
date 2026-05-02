import {
  hasDirectOutboundWaiter,
  registerDirectOutboundWaiter,
  rejectDirectOutboundWaiter,
  resolveDirectOutboundWaiter,
} from './directOutboundManager';

describe('directOutboundManager', () => {
  it('resolves a waiter with the answered channel', async () => {
    const waiter = registerDirectOutboundWaiter('token-1');
    expect(hasDirectOutboundWaiter('token-1')).toBe(true);

    resolveDirectOutboundWaiter('token-1', {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    });

    await expect(waiter).resolves.toEqual(
      expect.objectContaining({
        answered: true,
        channel: expect.objectContaining({ id: 'channel-1' }),
      }),
    );
  });

  it('rejects a waiter with the failure reason', async () => {
    const waiter = registerDirectOutboundWaiter('token-2');
    rejectDirectOutboundWaiter('token-2', 'timeout');

    await expect(waiter).resolves.toEqual({
      answered: false,
      reason: 'timeout',
    });
  });
});
