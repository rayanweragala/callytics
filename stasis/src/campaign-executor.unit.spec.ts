const mockPublisher = {
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  incr: jest.fn().mockResolvedValue(undefined),
  decr: jest.fn().mockResolvedValue(undefined),
};

const mockSubscriber = {
  pSubscribe: jest.fn().mockResolvedValue(undefined),
};

jest.mock('ari-client', () => ({}));
jest.mock('./db', () => ({ query: jest.fn() }));
jest.mock('./callSession', () => ({
  addSession: jest.fn(),
  createSession: jest.fn(),
  removeSession: jest.fn(),
}));
jest.mock('./flowLoader', () => ({ loadFlowById: jest.fn() }));
jest.mock('./runtime', () => ({ runFlow: jest.fn() }));
jest.mock('./telemetry', () => ({ publishCallEvent: jest.fn() }));
jest.mock('./redis', () => ({
  getPublisher: jest.fn(async () => mockPublisher),
  getSubscriber: jest.fn(async () => mockSubscriber),
  publish: jest.fn(async () => undefined),
}));
jest.mock('./lib/trunkResolver', () => ({
  fetchTrunkDialFormat: jest.fn().mockResolvedValue('{number}'),
}));

import { query } from './db';
import { CampaignExecutor } from './campaign-executor';
import { publish } from './redis';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockPublish = publish as jest.MockedFunction<typeof publish>;

function mockJsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: jest.fn(async () => payload),
    text: jest.fn(async () => JSON.stringify(payload)),
  };
}

describe('campaign-executor', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    mockQuery.mockResolvedValue([{ id: 9001 }] as any);
  });

  it('subscribes to campaign:start and campaign:stop channels on init', async () => {
    const executor = new CampaignExecutor();

    await executor.start();

    expect(mockSubscriber.pSubscribe).toHaveBeenCalledWith('campaign:start:*', expect.any(Function));
    expect(mockSubscriber.pSubscribe).toHaveBeenCalledWith('campaign:stop:*', expect.any(Function));
  });

  it('starts dialing with a sliding window when campaign:start is received', async () => {
    const executor = new CampaignExecutor();
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({
        id: 7,
        name: 'Outbound A',
        flowId: 99,
        trunkId: 5,
        maxConcurrent: 2,
        maxRetries: 0,
        retryIntervalMinutes: 1,
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        contacts: [
          { id: 101, phoneNumber: '15550000001', attempts: 0 },
          { id: 102, phoneNumber: '15550000002', attempts: 0 },
          { id: 103, phoneNumber: '15550000003', attempts: 0 },
        ],
      }))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'ch-1' }))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'ch-2' }));

    await executor.start();
    const onStart = mockSubscriber.pSubscribe.mock.calls.find((call) => call[0] === 'campaign:start:*')?.[1];

    expect(onStart).toBeDefined();
    await onStart?.('', 'campaign:start:7');

    const originateCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/ari/channels'));
    expect(originateCalls).toHaveLength(2);
    expect(mockPublisher.set).toHaveBeenCalledWith('campaign:active:7', '0');
  });

  it('publishes campaign:contact:update when a dialed contact call completes', async () => {
    const executor = new CampaignExecutor();
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({
        id: 7,
        name: 'Outbound B',
        flowId: 99,
        trunkId: 5,
        maxConcurrent: 1,
        maxRetries: 0,
        retryIntervalMinutes: 1,
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        contacts: [{ id: 201, phoneNumber: '15550000011', attempts: 0 }],
      }))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'ch-201' }));

    await executor.start();
    const onStart = mockSubscriber.pSubscribe.mock.calls.find((call) => call[0] === 'campaign:start:*')?.[1];
    await onStart?.('', 'campaign:start:7');

    await executor.handleChannelEnd('ch-201');

    expect(mockPublish).toHaveBeenCalledWith(
      'campaign:contact:update',
      expect.objectContaining({
        campaignId: 7,
        contactId: 201,
        status: 'failed',
        callId: 'ch-201',
      }),
    );
  });

  it('publishes campaign:completed when all contacts are dialed and finished', async () => {
    const executor = new CampaignExecutor();
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({
        id: 7,
        name: 'Outbound C',
        flowId: 99,
        trunkId: 5,
        maxConcurrent: 1,
        maxRetries: 0,
        retryIntervalMinutes: 1,
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        contacts: [{ id: 301, phoneNumber: '15550000021', attempts: 0 }],
      }))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'ch-301' }));

    await executor.start();
    const onStart = mockSubscriber.pSubscribe.mock.calls.find((call) => call[0] === 'campaign:start:*')?.[1];
    await onStart?.('', 'campaign:start:7');

    await executor.handleChannelEnd('ch-301');

    expect(mockPublish).toHaveBeenCalledWith('campaign:completed', { campaignId: 7 });
  });

  it('stops dialing on campaign:stop and publishes campaign:cancelled', async () => {
    const executor = new CampaignExecutor();
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({
        id: 7,
        name: 'Outbound D',
        flowId: 99,
        trunkId: 5,
        maxConcurrent: 1,
        maxRetries: 0,
        retryIntervalMinutes: 1,
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        contacts: [{ id: 401, phoneNumber: '15550000031', attempts: 0 }],
      }))
      .mockResolvedValueOnce(mockJsonResponse({ id: 'ch-401' }));

    await executor.start();
    const onStart = mockSubscriber.pSubscribe.mock.calls.find((call) => call[0] === 'campaign:start:*')?.[1];
    const onStop = mockSubscriber.pSubscribe.mock.calls.find((call) => call[0] === 'campaign:stop:*')?.[1];

    await onStart?.('', 'campaign:start:7');
    await onStop?.('', 'campaign:stop:7');
    await executor.handleChannelEnd('ch-401');

    expect(mockPublish).toHaveBeenCalledWith('campaign:cancelled', { campaignId: 7 });
  });
});
