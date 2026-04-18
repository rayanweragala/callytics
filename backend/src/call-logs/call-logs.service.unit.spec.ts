import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CallLogsService } from './call-logs.service';

describe('CallLogsService', () => {
  let service: CallLogsService;
  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallLogsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(CallLogsService);
    jest.clearAllMocks();
  });

  it('returns trace nodes ordered with durationMs computed', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        { callUuid: 'call-1', callerNumber: '94770000000', startedAt: '2026-04-17T10:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        {
          id: 10,
          nodeKey: 'start_1',
          nodeType: 'start',
          enteredAt: '2026-04-17T10:00:00.000Z',
          exitedAt: '2026-04-17T10:00:01.200Z',
          exitBranch: 'default',
          errorMessage: null,
        },
        {
          id: 11,
          nodeKey: 'menu_1',
          nodeType: 'menu',
          enteredAt: '2026-04-17T10:00:01.500Z',
          exitedAt: null,
          exitBranch: null,
          errorMessage: null,
        },
      ]);

    const result = await service.getTrace('call-1');

    expect(result.callUuid).toBe('call-1');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toEqual(expect.objectContaining({
      id: 10,
      nodeKey: 'start_1',
      durationMs: 1200,
      exitBranch: 'default',
    }));
    expect(result.nodes[1]).toEqual(expect.objectContaining({
      id: 11,
      nodeKey: 'menu_1',
      durationMs: null,
    }));
  });
});
