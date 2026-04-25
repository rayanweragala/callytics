import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createClient } from 'redis';
import { CallbacksService } from './callbacks.service';

jest.mock('../db/run-sql-migrations', () => ({
  runSqlMigrations: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

describe('CallbacksService', () => {
  let service: CallbacksService;

  const mockDataSource = {
    query: jest.fn(),
  };

  const mockRedisSubscriber = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };

  const mockRedisPublisher = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    publish: jest.fn().mockResolvedValue(1),
    disconnect: jest.fn().mockResolvedValue(undefined),
    duplicate: jest.fn(() => mockRedisSubscriber),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue(mockRedisPublisher);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallbacksService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<CallbacksService>(CallbacksService);
    process.env.REDIS_PORT = '6379';
  });

  afterEach(() => {
    delete process.env.REDIS_PORT;
  });

  it('executeCallback publishes callback:execute with extension dial string', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{
        id: 55,
        customerNumber: '+94771234567',
        operatorId: null,
        customerTrunkId: 6,
        destinationType: 'extension',
        destinationValue: '2001',
        destinationTrunkId: null,
        status: 'pending',
      }])
      .mockResolvedValueOnce([{ fromUser: '+94112233445' }])
      .mockResolvedValueOnce([]);

    await service.executeCallback(55);

    expect(mockRedisPublisher.publish).toHaveBeenCalledWith(
      'callback:execute',
      expect.stringContaining('"operatorDialString":"PJSIP/2001"'),
    );
    expect(mockRedisPublisher.publish).toHaveBeenCalledWith(
      'callback:execute',
      expect.stringContaining('"customerTrunkId":6'),
    );
  });

  it('executeCallback publishes callback:execute with PSTN operator dial string', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{
        id: 56,
        customerNumber: '+94771234568',
        operatorId: null,
        customerTrunkId: 7,
        destinationType: 'pstn',
        destinationValue: '+94770000000',
        destinationTrunkId: 4,
        status: 'pending',
      }])
      .mockResolvedValueOnce([{ fromUser: '+94110000000' }])
      .mockResolvedValueOnce([]);

    await service.executeCallback(56);

    expect(mockRedisPublisher.publish).toHaveBeenCalledWith(
      'callback:execute',
      expect.stringContaining('"operatorDialString":"PJSIP/+94770000000@trunk-4"'),
    );
  });

  it('executeCallback publishes callback:execute with extension destination when operator is null', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{
        id: 57,
        customerNumber: '2001',
        operatorId: null,
        customerTrunkId: null,
        destinationType: 'extension',
        destinationValue: '1234',
        destinationTrunkId: null,
        status: 'pending',
      }])
      .mockResolvedValueOnce([]);

    await service.executeCallback(57);

    expect(mockRedisPublisher.publish).toHaveBeenCalledWith(
      'callback:execute',
      expect.stringContaining('"operatorDialString":"PJSIP/1234"'),
    );
    expect(mockRedisPublisher.publish).toHaveBeenCalledWith(
      'callback:execute',
      expect.stringContaining('"customerDialString":"PJSIP/2001"'),
    );
  });

  it('listCallbacks returns paginated data', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 1,
          flowId: 2,
          trunkId: 3,
          customerNumber: '+94771234567',
          operatorId: 4,
          operatorName: 'Alice',
          status: 'pending',
          failReason: null,
          callLogId: null,
          createdAt: '2026-04-24T12:00:00.000Z',
          executedAt: null,
          completedAt: null,
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const result = await service.listCallbacks({ page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        id: 1,
        customerNumber: '+94771234567',
        operatorName: 'Alice',
      }),
    );
  });

  it('handleCallbackCreated writes failed record when customer number is null', async () => {
    await service.handleCallbackCreated({
      flowId: 1,
      trunkId: 2,
      customerNumber: null,
      operatorId: 3,
      destinationType: 'extension',
      destinationValue: '1234',
      destinationTrunkId: null,
      callLogId: 4,
    });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("'failed'"),
      [1, 2, '', 3, 'extension', '1234', null, 'invalid_customer_number', 4],
    );
  });

  it('handleCallbackCreated preserves explicit fail reason from stasis', async () => {
    await service.handleCallbackCreated({
      flowId: 1,
      trunkId: null,
      customerNumber: null,
      operatorId: 3,
      destinationType: 'extension',
      destinationValue: '1234',
      destinationTrunkId: null,
      callLogId: 4,
      failReason: 'dtmf_timeout',
    });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("'failed'"),
      [1, null, '', 3, 'extension', '1234', null, 'dtmf_timeout', 4],
    );
  });

  it('handleCallbackCreated keeps internal extension-like customer numbers', async () => {
    await service.handleCallbackCreated({
      flowId: 1,
      trunkId: null,
      customerNumber: '2001',
      operatorId: 3,
      destinationType: 'extension',
      destinationValue: '1234',
      destinationTrunkId: null,
      callLogId: 4,
    });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining("'pending'"),
      [1, null, '2001', 3, 'extension', '1234', null, 4],
    );
  });
});
