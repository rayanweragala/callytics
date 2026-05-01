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
    (net.createConnection as unknown as jest.Mock).mockReturnValue({
      setTimeout: jest.fn((_timeout: number, callback?: () => void) => {
        callback?.();
      }),
      on: jest.fn(),
      end: jest.fn(),
      write: jest.fn(),
    });

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

  it('testTrunk uses qualify as the SIP source of truth and attaches raw capture from sip_messages', async () => {
    mockRepo.findOne.mockResolvedValue({
      id: 4,
      host: 'sip.example.com',
      port: 5060,
      username: null,
      fromDomain: null,
      fromUser: null,
    });
    jest.spyOn(service, 'testTrunkTcp').mockResolvedValue({ reachable: true, latencyMs: 12, message: 'Reachable' });
    mockAsterisk.qualifyEndpoint.mockResolvedValue({ status: 'reachable', rtt_ms: 21, message: 'Reachable' });
    mockDataSource.query.mockResolvedValue([
      {
        id: 1,
        callId: 'call-1',
        timestamp: '2026-04-26T10:00:00.000Z',
        method: 'OPTIONS',
        fromUri: 'sip:asterisk@local',
        toUri: 'sip:provider@sip.example.com',
        direction: 'outbound',
        responseCode: null,
        rawMessage: 'OPTIONS sip:sip.example.com SIP/2.0\r\nCSeq: 1 OPTIONS',
        createdAt: '2026-04-26T10:00:00.000Z',
      },
      {
        id: 2,
        callId: 'call-1',
        timestamp: '2026-04-26T10:00:01.000Z',
        method: '200 OK',
        fromUri: 'sip:provider@sip.example.com',
        toUri: 'sip:asterisk@local',
        direction: 'inbound',
        responseCode: 200,
        rawMessage: 'SIP/2.0 200 OK\r\nCSeq: 1 OPTIONS\r\n\r\nm=audio 49170 RTP/AVP 0 8\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000',
        createdAt: '2026-04-26T10:00:01.000Z',
      },
    ]);

    const result = await service.testTrunk(4);

    expect(result.sipCode).toBe(200);
    expect(result.sipCodeTitle).toBe('Success');
    expect(result.rawCaptureAvailable).toBe(true);
    expect(result.rawOptionsSent).toContain('OPTIONS sip:sip.example.com SIP/2.0');
    expect(result.rawOptionsResponse).toContain('SIP/2.0 200 OK');
    expect(result.codecsSupported).toEqual(['PCMU', 'PCMA']);
  });

  it('testTrunk returns rawCaptureAvailable false when no matching capture exists', async () => {
    mockRepo.findOne.mockResolvedValue({
      id: 5,
      host: 'sip.missing.example',
      port: 5060,
      username: null,
      fromDomain: null,
      fromUser: null,
    });
    jest.spyOn(service, 'testTrunkTcp').mockResolvedValue({ reachable: true, latencyMs: 12, message: 'Reachable' });
    mockAsterisk.qualifyEndpoint.mockResolvedValue({ status: 'unreachable', rtt_ms: null, message: 'Unreachable' });
    mockDataSource.query.mockResolvedValue([]);

    const result = await service.testTrunk(5);

    expect(result.sipCode).toBe(503);
    expect(result.rawCaptureAvailable).toBe(false);
    expect(result.rawOptionsSent).toBe('');
    expect(result.rawOptionsResponse).toBe('');
    expect(result.codecsSupported).toEqual([]);
  });

  it('returns registered status when AMI reports Reachable', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([
      { endpoint: '1001', aor: '1001', contacts: ['sip:1001@127.0.0.1'] },
    ]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([
      { endpoint: '1001', aor: '1001', contacts: ['sip:1001@127.0.0.1'], contactStatus: 'Reachable', roundtripUsec: '12000', lastSeen: '2026-04-17T00:00:00.000Z', expiresAt: '2026-04-17T00:05:00.000Z' },
    ]);
    jest.spyOn(service as any, 'getPjsipInboundRegistrationStatuses').mockResolvedValue([]);
    mockDataSource.query
      .mockResolvedValueOnce([{ username: '1001', displayName: 'Alice' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSipRegistrations();

    expect(result.extensions[0]).toEqual(expect.objectContaining({
      extension: '1001',
      displayName: 'Alice',
      status: 'registered',
      registeredIp: '127.0.0.1',
    }));
  });

  it('returns unregistered status when AMI reports Unreachable', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([
      { endpoint: '1002', aor: '1002', contacts: [] },
    ]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([
      { endpoint: '1002', aor: '1002', contacts: ['sip:1002@127.0.0.1'], contactStatus: 'Unreachable', roundtripUsec: null, lastSeen: null, expiresAt: null },
    ]);
    jest.spyOn(service as any, 'getPjsipInboundRegistrationStatuses').mockResolvedValue([]);
    mockDataSource.query
      .mockResolvedValueOnce([{ username: '1002', displayName: 'Bob' }])
      .mockResolvedValueOnce([]);

    const result = await service.getSipRegistrations();

    expect(result.extensions[0]).toEqual(expect.objectContaining({
      extension: '1002',
      status: 'unregistered',
      registeredIp: null,
    }));
  });

  it('handles AMI timeout gracefully', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([]);
    jest.spyOn(service as any, 'getPjsipInboundRegistrationStatuses').mockResolvedValue([]);
    mockDataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.getSipRegistrations();

    expect(result.extensions).toEqual([]);
    expect(result.trunks).toEqual([]);
  });

  it('returns trunk registration health from AMI inbound registration statuses', async () => {
    mockAsterisk.getPjsipEndpoints.mockResolvedValue([]);
    jest.spyOn(service as any, 'getPjsipContacts').mockResolvedValue([]);
    jest.spyOn(service as any, 'getPjsipInboundRegistrationStatuses').mockResolvedValue([
      { trunkName: 'trunk-9', host: '198.51.100.10', status: 'registered', lastRegistration: '2026-04-17T00:00:00.000Z', expiresAt: '2026-04-17T00:05:00.000Z' },
    ]);
    mockDataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 9, name: 'Provider', host: '198.51.100.10' }]);

    const result = await service.getSipRegistrations();

    expect(result.trunks[0]).toEqual(expect.objectContaining({
      trunkName: 'Provider',
      host: '198.51.100.10',
      status: 'registered',
    }));
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

  it('broadcasts call timeline event when valid redis timeline payload arrives', async () => {
    const gateway = {
      broadcastCallTimelineEvent: jest.fn(),
    };
    service.setGateway(gateway as any);

    await (service as any).initializeSipTrafficRelay();

    const onCallTimeline = sipSubscriptions.get('callytics:call-timeline');
    expect(onCallTimeline).toBeDefined();

    const payload = {
      callId: 'call-live-1',
      flowId: 7,
      nodeId: 'menu-1776264496563-1',
      nodeType: 'menu',
      status: 'started' as const,
      ts: 1710000000000,
      meta: { result: '1' },
    };

    await onCallTimeline?.(JSON.stringify(payload));

    expect(gateway.broadcastCallTimelineEvent).toHaveBeenCalledWith(payload);
  });

  it('ignores call timeline payloads without callId', async () => {
    const gateway = {
      broadcastCallTimelineEvent: jest.fn(),
    };
    service.setGateway(gateway as any);

    await (service as any).initializeSipTrafficRelay();

    const onCallTimeline = sipSubscriptions.get('callytics:call-timeline');
    expect(onCallTimeline).toBeDefined();

    await onCallTimeline?.(JSON.stringify({
      flowId: 7,
      nodeId: 'menu-1776264496563-1',
      nodeType: 'menu',
      status: 'started',
      ts: 1710000000000,
      meta: {},
    }));

    expect(gateway.broadcastCallTimelineEvent).not.toHaveBeenCalled();
  });
});
