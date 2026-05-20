import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WebhookDeliveryEntity } from './entities/webhook-delivery.entity';
import { WebhookDeliveryEvent, WebhooksService } from './webhooks.service';

function makeEvent(overrides: Partial<WebhookDeliveryEvent> = {}): WebhookDeliveryEvent {
  return {
    flow_id: 12,
    node_id: 'wh-1',
    call_id: 'call-1',
    url: 'https://example.com/hook',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"hello":"world"}',
    attempt_number: 1,
    http_status: 503,
    response_body: 'upstream failed',
    success: false,
    error_message: null,
    retry_enabled: true,
    max_attempts: 3,
    retry_on_5xx: true,
    retry_on_timeout: true,
    retry_on_4xx: false,
    ...overrides,
  };
}

describe('WebhooksService', () => {
  let service: WebhooksService;

  const mockRepository = {
    create: jest.fn((value: Partial<WebhookDeliveryEntity>) => value),
    save: jest.fn(),
    findAndCount: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: getRepositoryToken(WebhookDeliveryEntity),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('logDelivery writes correct fields', async () => {
    const createdAt = new Date('2026-05-17T10:00:00.000Z');
    mockRepository.save.mockResolvedValue({
      id: 'uuid-1',
      flowId: 12,
      nodeId: 'wh-1',
      callId: 'call-1',
      url: 'https://example.com/hook',
      attemptNumber: 2,
      httpStatus: 202,
      responseBody: 'accepted',
      success: true,
      errorMessage: null,
      createdAt,
    });

    const result = await service.logDelivery(makeEvent({
      attempt_number: 2,
      http_status: 202,
      response_body: 'accepted',
      success: true,
    }));

    expect(mockRepository.create).toHaveBeenCalledWith({
      flowId: 12,
      nodeId: 'wh-1',
      callId: 'call-1',
      url: 'https://example.com/hook',
      attemptNumber: 2,
      httpStatus: 202,
      responseBody: 'accepted',
      success: true,
      errorMessage: null,
    });
    expect(result).toEqual({
      id: 'uuid-1',
      flowId: 12,
      nodeId: 'wh-1',
      callId: 'call-1',
      url: 'https://example.com/hook',
      attemptNumber: 2,
      httpStatus: 202,
      responseBody: 'accepted',
      success: true,
      errorMessage: null,
      createdAt: createdAt.toISOString(),
    });
  });

  it('scheduleRetry does not retry when attempt_number >= max_attempts', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.scheduleRetry(makeEvent({
      attempt_number: 3,
      max_attempts: 3,
    }));

    await jest.runOnlyPendingTimersAsync();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('scheduleRetry does not retry when failure reason does not match retry config', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.scheduleRetry(makeEvent({
      http_status: 400,
      retry_on_4xx: false,
    }));

    await jest.runOnlyPendingTimersAsync();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('scheduleRetry retries with correct backoff delay when conditions are met', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    } as Response);
    const logDeliverySpy = jest.spyOn(service, 'logDelivery').mockResolvedValue({
      id: 'uuid-2',
      flowId: 12,
      nodeId: 'wh-1',
      callId: 'call-1',
      url: 'https://example.com/hook',
      attemptNumber: 2,
      httpStatus: 200,
      responseBody: 'ok',
      success: true,
      errorMessage: null,
      createdAt: new Date('2026-05-17T10:05:00.000Z').toISOString(),
    });

    await service.scheduleRetry(makeEvent({
      max_attempts: 2,
    }));

    expect(fetchSpy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(4999);
    expect(fetchSpy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"hello":"world"}',
      }),
    );
    expect(logDeliverySpy).toHaveBeenCalledWith(expect.objectContaining({
      attempt_number: 2,
      http_status: 200,
      response_body: 'ok',
      success: true,
      error_message: null,
    }));
  });
});
