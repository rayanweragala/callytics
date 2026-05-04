const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  sCard: jest.fn().mockResolvedValue(0),
  sPop: jest.fn().mockResolvedValue(null),
  sAdd: jest.fn().mockResolvedValue(undefined),
  rPush: jest.fn().mockResolvedValue(undefined),
  lRem: jest.fn().mockResolvedValue(undefined),
  sRem: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  lLen: jest.fn().mockResolvedValue(0),
  lPop: jest.fn().mockResolvedValue(null),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  removeListener: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

jest.mock('../db', () => ({ query: jest.fn() }));

import { loginOperator, logoutOperator, onCustomerHangup, connectNextCustomer } from './queueManager';

describe('queueManager', () => {
  const fakeAri = {
    bridges: {
      create: jest.fn(),
      addChannel: jest.fn(),
      destroy: jest.fn(),
    },
    channels: {
      originate: jest.fn(),
      startMoh: jest.fn().mockResolvedValue(undefined),
      stopMoh: jest.fn().mockResolvedValue(undefined),
    },
    on: jest.fn(),
    removeListener: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loginOperator adds operator to free set and stores channel id', async () => {
    await loginOperator(1, 42, 'ch-1', fakeAri);

    expect(mockRedisClient.sAdd).toHaveBeenCalledWith('queue:1:operators', '42');
    expect(mockRedisClient.set).toHaveBeenCalledWith('operator:42:channel', 'ch-1');
  });

  it('logoutOperator removes operator from free and busy sets and clears keys', async () => {
    await logoutOperator(42, 1);

    expect(mockRedisClient.sRem).toHaveBeenCalledWith('queue:1:operators', '42');
    expect(mockRedisClient.sRem).toHaveBeenCalledWith('queue:1:busy', '42');
    expect(mockRedisClient.del).toHaveBeenCalledWith('operator:42:queue');
    expect(mockRedisClient.del).toHaveBeenCalledWith('operator:42:channel');
  });

  it('onCustomerHangup moves operator from busy back to free and checks waiting', async () => {
    mockRedisClient.lLen.mockResolvedValueOnce(0);
    mockRedisClient.get.mockResolvedValueOnce('operator-channel-42');

    await onCustomerHangup(42, 1, fakeAri);

    expect(mockRedisClient.sRem).toHaveBeenCalledWith('queue:1:busy', '42');
    expect(mockRedisClient.sAdd).toHaveBeenCalledWith('queue:1:operators', '42');
    expect(fakeAri.channels.startMoh).toHaveBeenCalledWith({ channelId: 'operator-channel-42', mohClass: 'callytics-hold' });
  });

  it('serves waiting customers in FIFO order as an operator becomes free repeatedly', async () => {
    fakeAri.bridges.create
      .mockResolvedValueOnce({ id: 'bridge-1' })
      .mockResolvedValueOnce({ id: 'bridge-2' });
    fakeAri.bridges.addChannel.mockResolvedValue(undefined);

    const waiting = ['customer-1', 'customer-2', 'customer-3'];
    const freeOperators = new Set<string>();
    const busyOperators = new Set<string>();
    const kv = new Map<string, string>([
      ['operator:42:channel', 'operator-channel-42'],
    ]);

    mockRedisClient.lPop.mockImplementation(async () => waiting.shift() ?? null);
    mockRedisClient.sAdd.mockImplementation(async (key: string, value: string) => {
      if (key === 'queue:1:operators') freeOperators.add(value);
      if (key === 'queue:1:busy') busyOperators.add(value);
      return 1 as any;
    });
    mockRedisClient.sRem.mockImplementation(async (key: string, value: string) => {
      if (key === 'queue:1:operators') freeOperators.delete(value);
      if (key === 'queue:1:busy') busyOperators.delete(value);
      return 1 as any;
    });
    mockRedisClient.sPop.mockImplementation(async () => {
      const value = freeOperators.values().next().value as string | undefined;
      if (!value) return null;
      freeOperators.delete(value);
      return value;
    });
    mockRedisClient.get.mockImplementation(async (key: string) => kv.get(key) ?? null);
    mockRedisClient.set.mockImplementation(async (key: string, value: string) => {
      kv.set(key, value);
      return 'OK' as any;
    });

    // Customer queue already has 3 callers; one operator is currently free.
    freeOperators.add('42');
    await connectNextCustomer(1, fakeAri as any);

    // First waiting customer connects first.
    expect(fakeAri.bridges.create).toHaveBeenCalled();
    expect(fakeAri.channels.stopMoh).toHaveBeenCalledWith({ channelId: 'operator-channel-42' });
    expect(fakeAri.bridges.addChannel).toHaveBeenCalledWith(expect.objectContaining({ channel: 'customer-1' }));

    // First call ends, operator returns to free pool, second waiting customer connects next.
    await onCustomerHangup(42, 1, fakeAri);

    expect(fakeAri.bridges.addChannel).toHaveBeenCalledWith(expect.objectContaining({ channel: 'customer-2' }));
    expect(waiting).toEqual(['customer-3']);
  });
});
