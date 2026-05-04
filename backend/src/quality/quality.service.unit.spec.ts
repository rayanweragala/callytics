import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { QualityService } from './quality.service';

describe('QualityService', () => {
  let service: QualityService;
  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(QualityService);
    jest.clearAllMocks();
  });

  it('findByCallId returns record when row exists', async () => {
    mockDataSource.query.mockResolvedValueOnce([
      {
        callId: 'call-1',
        mos: '3.91',
        jitter: '12.5',
        packetLoss: '1.4',
        rtt: '34.2',
        grade: 'fair',
        recordedAt: '2026-04-22T19:00:00.000Z',
      },
    ]);

    const result = await service.findByCallId('call-1');

    expect(result).toEqual({
      callId: 'call-1',
      mos: 3.91,
      jitter: 12.5,
      packetLoss: 1.4,
      rtt: 34.2,
      grade: 'fair',
      recordedAt: '2026-04-22T19:00:00.000Z',
    });
  });

  it('findByCallId returns null when row does not exist', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);

    const result = await service.findByCallId('missing-call');

    expect(result).toBeNull();
  });

  it('stream consumer writes correct values to DB', async () => {
    await (service as any).processStreamMessage({
      data: JSON.stringify({
        callId: 'call-2',
        mos: 3.77,
        jitter: 22.3,
        packetLoss: 2.1,
        rtt: 65.4,
        grade: 'fair',
        recordedAt: '2026-04-22T19:01:00.000Z',
      }),
    });

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO call_quality'),
      [
        'call-2',
        3.77,
        22.3,
        2.1,
        65.4,
        'fair',
        '2026-04-22T19:01:00.000Z',
      ],
    );
  });

  it('upsert uses ON CONFLICT update for worse values', async () => {
    await (service as any).upsertQuality({
      callId: 'call-3',
      mos: 2.55,
      jitter: 88,
      packetLoss: 8,
      rtt: 220,
      grade: 'poor',
      recordedAt: '2026-04-22T19:02:00.000Z',
    });

    const sql = mockDataSource.query.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT (call_id) DO UPDATE SET');
    expect(sql).toContain('LEAST');
    expect(sql).toContain('GREATEST');
    expect(sql).toContain('WHERE');
  });
});
