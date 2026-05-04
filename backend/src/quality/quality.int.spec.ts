import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { getDataSourceToken } from '@nestjs/typeorm';
import { QualityController } from './quality.controller';
import { QualityService } from './quality.service';

describe('QualityController', () => {
  let app: INestApplication;
  const mockService = {
    findByCallId: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [QualityController],
      providers: [{ provide: QualityService, useValue: mockService }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /quality/:callId returns 200 with expected shape', async () => {
    mockService.findByCallId.mockResolvedValueOnce({
      callId: 'call-1',
      mos: 4.11,
      jitter: 10,
      packetLoss: 0.7,
      rtt: 22,
      grade: 'good',
      recordedAt: '2026-04-22T19:30:00.000Z',
    });

    const response = await request(app.getHttpServer()).get('/quality/call-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      callId: 'call-1',
      mos: expect.any(Number),
      jitter: expect.any(Number),
      packetLoss: expect.any(Number),
      rtt: expect.any(Number),
      grade: expect.any(String),
      recordedAt: expect.any(String),
    }));
  });

  it('GET /quality/:callId returns 404 when no row exists', async () => {
    mockService.findByCallId.mockResolvedValueOnce(null);

    const response = await request(app.getHttpServer()).get('/quality/missing');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('No quality data for this call');
  });
});

describe('QualityService round-trip', () => {
  it('Redis payload -> consumer process -> DB upsert -> query by callId', async () => {
    const state = new Map<string, any>();
    const mockDataSource = {
      query: jest.fn(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO call_quality')) {
          const [callId, mos, jitter, packetLoss, rtt, grade, recordedAt] = params;
          state.set(callId, {
            callId,
            mos,
            jitter,
            packetLoss,
            rtt,
            grade,
            recordedAt,
          });
          return [];
        }

        if (sql.includes('FROM call_quality')) {
          const callId = params[0];
          const row = state.get(callId);
          if (!row) {
            return [];
          }
          return [{
            callId: row.callId,
            mos: String(row.mos),
            jitter: String(row.jitter),
            packetLoss: String(row.packetLoss),
            rtt: String(row.rtt),
            grade: row.grade,
            recordedAt: row.recordedAt,
          }];
        }

        return [];
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        QualityService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    const service = moduleRef.get(QualityService);

    await (service as any).processStreamMessage({
      data: JSON.stringify({
        callId: 'call-9',
        mos: 2.93,
        jitter: 90,
        packetLoss: 6,
        rtt: 180,
        grade: 'poor',
        recordedAt: '2026-04-22T19:40:00.000Z',
      }),
    });

    const result = await service.findByCallId('call-9');
    expect(result).toEqual(expect.objectContaining({
      callId: 'call-9',
      mos: 2.93,
      jitter: 90,
      packetLoss: 6,
      rtt: 180,
      grade: 'poor',
    }));

    await moduleRef.close();
  });
});
