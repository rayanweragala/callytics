import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

describe('DiagnosticsController', () => {
  let app: INestApplication;
  const mockService = {
    getSystemHealth: jest.fn(),
    testTrunk: jest.fn(),
    testAllTrunks: jest.fn(),
    getSipRegistrations: jest.fn(),
    getRecentFailures: jest.fn(),
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
    mockService.testTrunk.mockResolvedValue({ trunkId: 1, status: 'reachable' });
    mockService.testAllTrunks.mockResolvedValue({ data: [] });
    mockService.getSipRegistrations.mockResolvedValue({ data: [] });
    mockService.getRecentFailures.mockResolvedValue({ data: [], total: 0 });
  });

  it('GET /diagnostics/health returns system health', async () => {
    const response = await request(app.getHttpServer()).get('/diagnostics/health');
    expect(response.status).toBe(200);
    expect(mockService.getSystemHealth).toHaveBeenCalled();
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
});
