import { BadRequestException } from '@nestjs/common';
import { CampaignsScheduler } from './campaigns.scheduler';
import { CampaignsService } from './campaigns.service';

jest.mock('../db/run-sql-migrations', () => ({
  runSqlMigrations: jest.fn().mockResolvedValue(undefined),
}));

const mockRedisState: {
  publisher: any | null;
  subscriber: any | null;
  subscriptions: Record<string, (message: string) => Promise<void>>;
} = {
  publisher: null,
  subscriber: null,
  subscriptions: {},
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => {
    const subscriber = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockImplementation(async (channel: string, handler: (message: string) => Promise<void>) => {
        mockRedisState.subscriptions[channel] = handler;
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isReady: true,
      get: jest.fn().mockResolvedValue('0'),
    };

    const publisher = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isReady: true,
      get: jest.fn().mockResolvedValue('0'),
      duplicate: jest.fn(() => subscriber),
    };

    mockRedisState.publisher = publisher;
    mockRedisState.subscriber = subscriber;
    mockRedisState.subscriptions = {};

    return publisher;
  }),
}));

describe('CampaignsService', () => {
  let service: CampaignsService;
  const dataSource = {
    query: jest.fn(),
  };

  beforeEach(() => {
    process.env.REDIS_PORT = '6379';
    service = new CampaignsService(dataSource as any);
    jest.clearAllMocks();
    dataSource.query.mockReset();
    dataSource.query.mockResolvedValue([]);
    mockRedisState.publisher = null;
    mockRedisState.subscriber = null;
    mockRedisState.subscriptions = {};
  });

  afterEach(() => {
    delete process.env.REDIS_PORT;
    jest.useRealTimers();
  });

  it('create campaign returns draft status', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: 'April Outreach',
          status: 'draft',
          flowId: 3,
          trunkId: 1,
          scheduledAt: '2026-04-25T09:00:00.000Z',
          maxConcurrent: 3,
          maxRetries: 2,
          retryIntervalMinutes: 30,
          totalContacts: 0,
          dialedCount: 0,
          answeredCount: 0,
          failedCount: 0,
          createdAt: '2026-04-23T10:00:00.000Z',
          updatedAt: '2026-04-23T10:00:00.000Z',
          flowName: 'main',
          trunkName: 'sip',
          trunkCallerId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 5,
          name: 'April Outreach',
          status: 'draft',
          flowId: 3,
          trunkId: 1,
          scheduledAt: '2026-04-25T09:00:00.000Z',
          maxConcurrent: 3,
          maxRetries: 2,
          retryIntervalMinutes: 30,
          totalContacts: 0,
          dialedCount: 0,
          answeredCount: 0,
          failedCount: 0,
          createdAt: '2026-04-23T10:00:00.000Z',
          updatedAt: '2026-04-23T10:00:00.000Z',
          flowName: 'main',
          trunkName: 'sip',
          trunkCallerId: null,
        },
      ]);

    const created = await service.create({
      name: 'April Outreach',
      flowId: 3,
      trunkId: 1,
      scheduledAt: '2026-04-25T09:00:00.000Z',
      maxConcurrent: 3,
      maxRetries: 2,
      retryIntervalMinutes: 30,
    });

    expect(created.status).toBe('draft');
    expect(created.name).toBe('April Outreach');
  });

  it('CSV upload imports valid rows and skips invalid rows', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: 9, status: 'draft' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const csv = Buffer.from('phone_number,name\n+14155550100,Ada\n,Blank\ninvalid,Nope\n+14155550101,Bob\n');
    const result = await service.uploadContacts(9, csv);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(2);
  });

  it('schedule transition validates required fields', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        id: 1,
        name: 'C',
        status: 'draft',
        flowId: null,
        trunkId: 1,
        scheduledAt: '2026-04-25T09:00:00.000Z',
        maxConcurrent: 3,
        maxRetries: 2,
        retryIntervalMinutes: 30,
        totalContacts: 10,
        dialedCount: 0,
        answeredCount: 0,
        failedCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    await expect(service.schedule(1)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stop publishes campaign:stop event', async () => {
    jest.useFakeTimers();
    await service.onModuleInit();
    dataSource.query.mockResolvedValueOnce([
      {
        id: 1,
        name: 'C',
        status: 'running',
        flowId: 1,
        trunkId: 1,
        scheduledAt: '2026-04-25T09:00:00.000Z',
        maxConcurrent: 3,
        maxRetries: 2,
        retryIntervalMinutes: 30,
        totalContacts: 10,
        dialedCount: 2,
        answeredCount: 1,
        failedCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]).mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 1,
        name: 'C',
        status: 'cancelling',
        flowId: 1,
        trunkId: 1,
        scheduledAt: '2026-04-25T09:00:00.000Z',
        maxConcurrent: 3,
        maxRetries: 2,
        retryIntervalMinutes: 30,
        totalContacts: 10,
        dialedCount: 2,
        answeredCount: 1,
        failedCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const result = await service.stop(1);
    jest.runOnlyPendingTimers();
    expect(result.status).toBe('cancelling');
    expect(mockRedisState.publisher.publish).toHaveBeenCalledWith(
      'campaign:stop:1',
      expect.stringContaining('"campaignId":1'),
    );
  });

  it('start campaign publishes correct Redis event', async () => {
    await service.onModuleInit();

    dataSource.query
      .mockResolvedValueOnce([{ id: 77 }])
      .mockResolvedValueOnce([]);

    const started = await service.startDueCampaigns();

    expect(started).toEqual([77]);
    expect(mockRedisState.publisher.publish).toHaveBeenCalledWith(
      'campaign:start:77',
      expect.stringContaining('"campaignId":77'),
    );
  });

  it('contact status update handler updates contact record', async () => {
    await (service as any).handleCampaignContactUpdate({
      campaignId: 4,
      contactId: 21,
      status: 'completed',
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE campaign_contacts'),
      [21, 4, 'completed'],
    );
  });

  it('campaign completion handler sets status to completed', async () => {
    await service.onModuleInit();
    const completedHandler = mockRedisState.subscriptions['campaign:completed'];

    expect(completedHandler).toBeDefined();
    await completedHandler(JSON.stringify({ campaignId: 18 }));

    expect(dataSource.query).toHaveBeenCalledWith(
      "UPDATE campaigns SET status = 'completed', updated_at = NOW() WHERE id = $1",
      [18],
    );
  });

  it('scheduler finds due campaigns and publishes start events', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ id: 11 }, { id: 12 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.onModuleInit();
    const scheduler = new CampaignsScheduler(service);
    await scheduler.handleCron();

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining("WHERE status = 'scheduled'"));
  });
});
