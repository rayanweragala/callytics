import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DiagnosticsService } from './diagnostics.service';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import * as net from 'node:net';
import { createClient } from 'redis';

jest.mock('node:net');
jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

describe('DiagnosticsService', () => {
  let service: DiagnosticsService;
  const mockRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const mockDataSource = {
    query: jest.fn(),
  };
  const mockAsterisk = {
    checkAmiConnection: jest.fn(),
    qualifyEndpoint: jest.fn(),
    getPjsipEndpoints: jest.fn(),
  };
  const sipSubscriptions = new Map<string, (message: string) => Promise<void> | void>();
  const mockRedisSubscriber = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn(async (channel: string, handler: (message: string) => Promise<void> | void) => {
      sipSubscriptions.set(channel, handler);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiagnosticsService,
        { provide: getRepositoryToken(SipTrunkEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsterisk },
      ],
    }).compile();

    service = module.get(DiagnosticsService);
    sipSubscriptions.clear();
    (createClient as unknown as jest.Mock).mockReturnValue(mockRedisSubscriber);
    jest.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/asterisk/info')) {
        return {
          ok: true,
          json: async () => ({ system: { version: '20.0.0', uptime_seconds: 3600 } }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ([{ id: 'channel-1' }]),
      } as Response;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('getSystemHealth returns health data from mocked dependencies', async () => {
    mockAsterisk.checkAmiConnection.mockResolvedValue({ connected: true });
    mockDataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    jest.spyOn(service as any, 'checkRedis').mockResolvedValue({ reachable: true });

    const result = await service.getSystemHealth();

    expect(result.ari.connected).toBe(true);
    expect(result.ami.connected).toBe(true);
    expect(result.activeChannels).toBe(1);
    expect(result.postgres.reachable).toBe(true);
    expect(result.redis.reachable).toBe(true);
  });

  it('testTrunkTcp returns a reachable result when net connect succeeds', async () => {
    const mockSocket = {
      setTimeout: jest.fn(),
      connect: jest.fn((port, host, callback) => callback()),
      on: jest.fn(),
      destroy: jest.fn(),
    };
    (net.Socket as unknown as jest.Mock).mockReturnValue(mockSocket);

    const result = await service.testTrunkTcp('127.0.0.1', 5060);

    expect(result.reachable).toBe(true);
  });

  it('testTrunkSipOptions delegates to the AMI qualify action', async () => {
    mockAsterisk.qualifyEndpoint.mockResolvedValue({ status: 'reachable', rtt_ms: 18, message: 'Reachable' });

    const result = await service.testTrunkSipOptions(3);

    expect(mockAsterisk.qualifyEndpoint).toHaveBeenCalledWith('trunk-3');
    expect(result.status).toBe('reachable');
  });

  it('returns registered status when AMI reports Reachable', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([
      { endpoint: '1001', aor: '1001', contacts: ['sip:1001@127.0.0.1'] },
    ]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([
      { endpoint: '1001', aor: '1001', contacts: ['sip:1001@127.0.0.1'], contactStatus: 'Reachable', roundtripUsec: '12000', lastQualifiedAt: '2026-04-17T00:00:00.000Z' },
    ]);
    mockDataSource.query
      .mockResolvedValueOnce([{ username: '1001' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSipRegistrations();

    expect(result.data[0]).toEqual(expect.objectContaining({
      name: '1001',
      status: 'registered',
      roundtripMs: 12,
    }));
  });

  it('returns unregistered status when AMI reports Unreachable', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([
      { endpoint: '1002', aor: '1002', contacts: [] },
    ]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([
      { endpoint: '1002', aor: '1002', contacts: ['sip:1002@127.0.0.1'], contactStatus: 'Unreachable', roundtripUsec: null, lastQualifiedAt: null },
    ]);
    mockDataSource.query
      .mockResolvedValueOnce([{ username: '1002' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSipRegistrations();

    expect(result.data[0]).toEqual(expect.objectContaining({
      name: '1002',
      status: 'unregistered',
    }));
  });

  it('handles AMI timeout gracefully', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([]);
    mockDataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSipRegistrations();

    expect(result.data).toEqual([]);
  });

  it('returns only non-completed calls', async () => {
    mockDataSource.query.mockResolvedValue([
      {
        callId: 1,
        callUuid: 'call-1',
        callerNumber: '1001',
        flowName: 'Main',
        failedNodeType: 'transfer',
        errorMessage: 'Busy',
        startedAt: '2026-04-17T00:00:00.000Z',
        durationSeconds: 4,
      },
    ]);

    const result = await service.getRecentFailures();

    expect(result.total).toBe(1);
    expect(result.data[0].callId).toBe('1');
    expect(result.data[0].callUuid).toBe('call-1');
  });

  it('includes end_reason as errorMessage', async () => {
    mockDataSource.query.mockResolvedValue([
      {
        callId: 2,
        callUuid: 'call-2',
        callerNumber: '1002',
        flowName: 'Main',
        failedNodeType: 'hangup',
        errorMessage: 'SIP 486 Busy',
        startedAt: '2026-04-17T00:00:00.000Z',
        durationSeconds: 7,
      },
    ]);

    const result = await service.getRecentFailures();

    expect(result.data[0].errorMessage).toBe('SIP 486 Busy');
  });

  it('returns null errorMessage when no error exists', async () => {
    mockDataSource.query.mockResolvedValue([
      {
        callId: 3,
        callUuid: 'call-3',
        callerNumber: '1003',
        flowName: 'Main',
        failedNodeType: null,
        errorMessage: null,
        startedAt: '2026-04-17T00:00:00.000Z',
        durationSeconds: 2,
      },
    ]);

    const result = await service.getRecentFailures();

    expect(result.data[0].errorMessage).toBeNull();
  });

  it('respects limit parameter', async () => {
    mockDataSource.query.mockResolvedValue([]);

    await service.getRecentFailures(250);

    expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [100]);
  });

  it('persists SIP traffic events into sip_messages with all mapped fields', async () => {
    await (service as any).initializeSipTrafficRelay();

    const onSipTraffic = sipSubscriptions.get('callytics:sip-traffic');
    expect(onSipTraffic).toBeDefined();

    const payload = {
      callId: 'abc-123',
      timestamp: '2026-04-21T20:00:00.000Z',
      method: 'INVITE',
      from: '<sip:1001@example.com>',
      to: '<sip:2001@example.com>',
      direction: 'inbound' as const,
      responseCode: 180,
      rawMessage: 'INVITE sip:2001@example.com SIP/2.0\nCall-ID: abc-123',
    };

    await onSipTraffic?.(JSON.stringify(payload));

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sip_messages'),
      [
        'abc-123',
        '2026-04-21T20:00:00.000Z',
        'INVITE',
        '<sip:1001@example.com>',
        '<sip:2001@example.com>',
        'inbound',
        180,
        'INVITE sip:2001@example.com SIP/2.0\nCall-ID: abc-123',
      ],
    );
  });

  it('persists SIP traffic events even when callId is null', async () => {
    await (service as any).initializeSipTrafficRelay();

    const onSipTraffic = sipSubscriptions.get('callytics:sip-traffic');
    expect(onSipTraffic).toBeDefined();

    const payload = {
      callId: null,
      timestamp: '2026-04-21T20:01:00.000Z',
      method: 'BYE',
      from: '<sip:2001@example.com>',
      to: '<sip:1001@example.com>',
      direction: 'outbound' as const,
      responseCode: 486,
      rawMessage: 'SIP/2.0 486 Busy Here',
    };

    await onSipTraffic?.(JSON.stringify(payload));

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sip_messages'),
      [
        null,
        '2026-04-21T20:01:00.000Z',
        'BYE',
        '<sip:2001@example.com>',
        '<sip:1001@example.com>',
        'outbound',
        486,
        'SIP/2.0 486 Busy Here',
      ],
    );
  });
});
