import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

describe('DiagnosticsController', () => {
  let app: INestApplication;
  const mockService = {
    getSystemHealth: jest.fn(),
    getResources: jest.fn(),
    testTrunk: jest.fn(),
    testAllTrunks: jest.fn(),
    getSipRegistrations: jest.fn(),
    getRecentFailures: jest.fn(),
    getSipMessages: jest.fn(),
    getSipMessagesByCallId: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DiagnosticsController],
      providers: [{ provide: DiagnosticsService, useValue: mockService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockService.getSystemHealth.mockResolvedValue({ checkedAt: new Date().toISOString(), items: [] });
    mockService.getResources.mockResolvedValue({
      cpu: { usage: 25 },
      memory: { total: 8000000000, used: 4000000000, free: 4000000000, usagePercent: 50 },
      disk: { total: 100000000000, used: 40000000000, free: 60000000000, usagePercent: 40 },
      asterisk: { activeChannels: 2 },
      network: { bytesSent: 2500000, bytesReceived: 6000000 },
    });
    mockService.testTrunk.mockResolvedValue({ trunkId: 1, status: 'reachable' });
    mockService.testAllTrunks.mockResolvedValue({ data: [] });
    mockService.getSipRegistrations.mockResolvedValue({ data: [] });
    mockService.getRecentFailures.mockResolvedValue({ data: [], total: 0 });
    mockService.getSipMessages.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    mockService.getSipMessagesByCallId.mockResolvedValue([]);
  });

  it('GET /diagnostics/health returns system health', async () => {
    const response = await request(app.getHttpServer()).get('/diagnostics/health');
    expect(response.status).toBe(200);
    expect(mockService.getSystemHealth).toHaveBeenCalled();
  });

  it('GET /diagnostics/resources returns resource metrics', async () => {
    const response = await request(app.getHttpServer()).get('/diagnostics/resources');
    expect(response.status).toBe(200);
    expect(mockService.getResources).toHaveBeenCalled();
    expect(response.body).toEqual(expect.objectContaining({ cpu: expect.any(Object) }));
  });

  it('POST /diagnostics/trunks/:id/test returns trunk test result', async () => {
    const response = await request(app.getHttpServer()).post('/diagnostics/trunks/1/test');
    expect(response.status).toBe(200);
    expect(mockService.testTrunk).toHaveBeenCalledWith(1);
  });

  it('GET /diagnostics/registrations returns registration data', async () => {
    const response = await request(app.getHttpServer()).get('/diagnostics/registrations');
    expect(response.status).toBe(200);
    expect(mockService.getSipRegistrations).toHaveBeenCalled();
  });

  it('GET /diagnostics/failures returns failure data', async () => {
    const response = await request(app.getHttpServer()).get('/diagnostics/failures');
    expect(response.status).toBe(200);
    expect(mockService.getRecentFailures).toHaveBeenCalledWith(20, 0);
  });

  it('GET /diagnostics/sip-messages without query params returns 200 and array data', async () => {
    mockService.getSipMessages.mockResolvedValueOnce({
      data: [
        { id: 1, callId: 'abc-123', timestamp: '2026-04-21T20:00:00.000Z' },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    const response = await request(app.getHttpServer()).get('/diagnostics/sip-messages');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(mockService.getSipMessages).toHaveBeenCalledWith(1, 50, undefined);
  });

  it('GET /diagnostics/sip-messages?callId=abc-123 returns filtered rows', async () => {
    mockService.getSipMessages.mockResolvedValueOnce({
      data: [
        { id: 2, callId: 'abc-123', timestamp: '2026-04-21T20:01:00.000Z' },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    const response = await request(app.getHttpServer()).get('/diagnostics/sip-messages?callId=abc-123');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ callId: 'abc-123' }),
    ]);
    expect(mockService.getSipMessages).toHaveBeenCalledWith(1, 50, 'abc-123');
  });

  it('GET /diagnostics/sip-messages/:callId returns 200 and callId rows', async () => {
    mockService.getSipMessagesByCallId.mockResolvedValueOnce([
      { id: 3, callId: 'abc-123', timestamp: '2026-04-21T20:02:00.000Z' },
    ]);

    const response = await request(app.getHttpServer()).get('/diagnostics/sip-messages/abc-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ callId: 'abc-123' }),
    ]);
    expect(mockService.getSipMessagesByCallId).toHaveBeenCalledWith('abc-123');
  });

  it('GET /diagnostics/sip-messages/:callId returns 200 and empty array when no rows exist', async () => {
    mockService.getSipMessagesByCallId.mockResolvedValueOnce([]);

    const response = await request(app.getHttpServer()).get('/diagnostics/sip-messages/missing-call');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(mockService.getSipMessagesByCallId).toHaveBeenCalledWith('missing-call');
  });
});
