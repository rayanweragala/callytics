jest.mock('./redis', () => ({
  publish: jest.fn(async () => undefined),
}));

import { executeCallback } from './callback-execute';
import { resolveCallbackWaiter } from './callbackManager';
import { publish } from './redis';

jest.mock('./lib/trunkResolver', () => ({
  fetchTrunkDialFormat: jest.fn().mockResolvedValue('{number}'),
}));

describe('callback-execute', () => {
  const mockPublish = publish as jest.MockedFunction<typeof publish>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks failed when operator does not answer in time', async () => {
    const originate = jest.fn().mockResolvedValue({ id: 'operator-orig' });

    const ariClient = {
      channels: { originate },
      bridges: {
        create: jest.fn(),
        addChannel: jest.fn(),
        destroy: jest.fn(),
      },
      on: jest.fn(),
      removeListener: jest.fn(),
    } as any;

    jest.useFakeTimers();
    const run = executeCallback(ariClient, {
      callbackId: 91,
      customerNumber: '+94771234567',
      customerTrunkId: 4,
      operatorDialString: 'PJSIP/2001',
      callerIdNumber: '+94112233445',
    });

    await jest.advanceTimersByTimeAsync(30_000);
    await run;
    jest.useRealTimers();

    expect(mockPublish).toHaveBeenCalledWith('callback:status:update', {
      callbackId: 91,
      status: 'failed',
      failReason: 'operator_no_answer',
    });
  });

  it('marks failed when customer does not answer in time', async () => {
    const originate = jest.fn().mockResolvedValue({ id: 'orig-id' });
    const startMoh = jest.fn().mockResolvedValue(undefined);
    const stopMoh = jest.fn().mockResolvedValue(undefined);

    const ariClient = {
      channels: { originate, startMoh, stopMoh },
      bridges: {
        create: jest.fn(),
        addChannel: jest.fn(),
        destroy: jest.fn(),
      },
      on: jest.fn(),
      removeListener: jest.fn(),
    } as any;

    jest.useFakeTimers();
    const run = executeCallback(ariClient, {
      callbackId: 92,
      customerNumber: '+94772223344',
      customerTrunkId: 6,
      operatorDialString: 'PJSIP/101',
      callerIdNumber: '+94110000000',
    });

    setTimeout(() => {
      resolveCallbackWaiter(92, 'operator', {
        id: 'op-ch',
        hangup: jest.fn().mockResolvedValue(undefined),
      });
    }, 100);

    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(30_000);
    await run;
    jest.useRealTimers();

    expect(mockPublish).toHaveBeenCalledWith('callback:status:update', {
      callbackId: 92,
      status: 'dialing_customer',
    });
    expect(mockPublish).toHaveBeenCalledWith('callback:status:update', {
      callbackId: 92,
      status: 'failed',
      failReason: 'customer_no_answer',
    });
    expect(startMoh).toHaveBeenCalledWith({ channelId: 'op-ch', mohClass: 'callytics-hold' });
    expect(stopMoh).toHaveBeenCalledWith({ channelId: 'op-ch' });
  });

  it('normalizes sri lankan customer number before trunk originate', async () => {
    const originate = jest.fn().mockResolvedValue({ id: 'orig-id' });

    const ariClient = {
      channels: { originate, startMoh: jest.fn().mockResolvedValue(undefined), stopMoh: jest.fn().mockResolvedValue(undefined) },
      bridges: {
        create: jest.fn(),
        addChannel: jest.fn(),
        destroy: jest.fn(),
      },
      on: jest.fn(),
      removeListener: jest.fn(),
    } as any;

    jest.useFakeTimers();
    const run = executeCallback(ariClient, {
      callbackId: 93,
      customerNumber: '0762192061',
      customerTrunkId: 3,
      operatorDialString: 'PJSIP/+94781100996@trunk-3',
      callerIdNumber: '+94110000000',
    });

    setTimeout(() => {
      resolveCallbackWaiter(93, 'operator', {
        id: 'op-ch-93',
        hangup: jest.fn().mockResolvedValue(undefined),
      });
    }, 100);

    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(30_000);
    await run;
    jest.useRealTimers();

    expect(originate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      endpoint: 'PJSIP/0762192061@trunk-3',
    }));
  });
});
