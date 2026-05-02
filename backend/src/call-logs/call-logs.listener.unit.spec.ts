import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CallLogsListener } from './call-logs.listener';

describe('CallLogsListener', () => {
  let listener: CallLogsListener;
  const dataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallLogsListener,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    listener = module.get(CallLogsListener);
  });

  it('inserts outbound direction on started events', async () => {
    dataSource.query.mockResolvedValue(undefined);

    await (listener as any).handleCallStarted({
      callId: 'call-1',
      timestamp: '2026-05-02T10:00:00.000Z',
      type: 'started',
      caller: '1001',
      callerId: '1001',
      destination: '94770000000',
      direction: 'outbound',
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO call_logs'),
      expect.arrayContaining(['outbound']),
    );
  });

  it('updates answered_at and duration on ended events', async () => {
    dataSource.query.mockResolvedValue(undefined);

    await (listener as any).handleCallEnded({
      callId: 'call-2',
      timestamp: '2026-05-02T10:01:00.000Z',
      type: 'ended',
      caller: '1002',
      answeredAt: '2026-05-02T10:00:10.000Z',
      endedAt: '2026-05-02T10:01:00.000Z',
      duration: 50,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('answered_at'),
      ['call-2', '2026-05-02T10:01:00.000Z', '2026-05-02T10:00:10.000Z', 50, null],
    );
  });
});
