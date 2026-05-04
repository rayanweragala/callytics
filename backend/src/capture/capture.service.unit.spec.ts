import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { createClient } from 'redis';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { CaptureService } from './capture.service';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

jest.mock('../db/run-sql-migrations', () => ({
  runSqlMigrations: jest.fn().mockResolvedValue(undefined),
}));

describe('CaptureService', () => {
  const env = process.env;
  const mockRedis = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    xAdd: jest.fn().mockResolvedValue('1-0'),
    xTrim: jest.fn().mockResolvedValue(1),
    xRevRange: jest.fn().mockResolvedValue([]),
    isOpen: true,
  };
  const mockDataSource = {
    query: jest.fn().mockResolvedValue([]),
  } as unknown as DataSource;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env, REDIS_HOST: '127.0.0.1', REDIS_PORT: '6380' };
    (createClient as jest.Mock).mockReturnValue(mockRedis);
  });

  afterAll(() => {
    process.env = env;
  });

  it('initializes redis on module init', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);

    await service.onModuleInit();

    expect(runSqlMigrations).toHaveBeenCalledWith(mockDataSource);
    expect((mockDataSource.query as jest.Mock).mock.calls).toEqual(
      expect.arrayContaining([
        [expect.stringContaining("DELETE FROM sip_packets")],
      ]),
    );
    expect(createClient).toHaveBeenCalledWith({
      socket: {
        host: '127.0.0.1',
        port: 6380,
      },
    });
    expect(mockRedis.connect).toHaveBeenCalled();
  });

  it('parseSipPacket maps tshark ek payload into dto', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);

    const packet = service.parseSipPacket(JSON.stringify({
      layers: {
        'frame.time_epoch': ['1713782577.000'],
        'sip.Method': ['INVITE'],
        'sip.From': ['<sip:1001@example.com>'],
        'sip.To': ['<sip:2001@example.com>'],
        'sip.Call-ID': ['call-abc-1'],
        'udp.dstport': ['5060'],
      },
    }));

    expect(packet).toEqual(expect.objectContaining({
      method: 'INVITE',
      from: '<sip:1001@example.com>',
      to: '<sip:2001@example.com>',
      callId: 'call-abc-1',
      direction: 'in',
    }));
  });

  it('writeToRedis writes xadd and xtrim with maxlen 500', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    await service.writeToRedis({
      id: '',
      timestamp: '10:42:57.000',
      method: 'INVITE',
      from: '<sip:1001@example.com>',
      to: '<sip:2001@example.com>',
      callId: 'call-abc-1',
      direction: 'in',
      statusCode: undefined,
      rawJson: '{"ok":true}',
    });

    expect(mockRedis.xAdd).toHaveBeenCalledWith(
      'callytics:sip-capture',
      '*',
      expect.objectContaining({ callId: 'call-abc-1' }),
    );
    expect(mockRedis.xTrim).toHaveBeenCalledWith('callytics:sip-capture', 'MAXLEN', 500);
  });

  it('reads and filters packets from redis stream', async () => {
    mockRedis.xRevRange.mockResolvedValue([
      {
        id: '2-0',
        message: {
          timestamp: '10:42:58.000',
          method: 'BYE',
          from: '1001',
          to: '1002',
          callId: 'call-2',
          direction: 'out',
          statusCode: '',
          rawJson: '{"id":2}',
        },
      },
      {
        id: '1-0',
        message: {
          timestamp: '10:42:57.000',
          method: 'INVITE',
          from: '1000',
          to: '1001',
          callId: 'call-1',
          direction: 'in',
          statusCode: '200',
          rawJson: '{"id":1}',
        },
      },
    ]);

    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    const packets = await service.getBulkPackets({ method: 'INVITE' });
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual(expect.objectContaining({ id: '1-0', callId: 'call-1', method: 'INVITE', statusCode: 200 }));

    const dialogPackets = await service.getDialogPackets('call-2');
    expect(dialogPackets).toHaveLength(1);
    expect(dialogPackets[0]).toEqual(expect.objectContaining({ id: '2-0', direction: 'out' }));
  });

  it('findPacketsByCallId returns stored packets and empty array for unknown callId', async () => {
    (mockDataSource.query as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ packetData: { id: '1-0', callId: 'call-1', method: 'INVITE' } }])
      .mockResolvedValueOnce([]);

    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    const known = await service.findPacketsByCallId('call-1');
    const unknown = await service.findPacketsByCallId('missing-call');

    expect(known).toEqual([{ id: '1-0', callId: 'call-1', method: 'INVITE' }]);
    expect(unknown).toEqual([]);
  });

  it('persistPacket inserts call_id and packet_data', async () => {
    (mockDataSource.query as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({});

    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    await service.persistPacket({
      id: '7-0',
      timestamp: '2026-04-23T07:00:00.000Z',
      method: 'INVITE',
      from: '1001',
      to: '1002',
      callId: 'call-persist-1',
      direction: 'in',
      rawJson: '{"ok":true}',
    });

    expect((mockDataSource.query as jest.Mock).mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining('INSERT INTO sip_packets'),
          expect.arrayContaining([
            'call-persist-1',
            expect.stringContaining('"callId":"call-persist-1"'),
            '2026-04-23T07:00:00.000Z',
          ]),
        ],
      ]),
    );
  });

  it('disconnects redis on module destroy', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(mockRedis.disconnect).toHaveBeenCalled();
  });

  it('exportBulkPcap writes valid pcap headers and non-truncated packet records', async () => {
    mockRedis.xRevRange.mockResolvedValue([
      {
        id: '1-0',
        message: {
          timestamp: '2026-05-03T10:00:00.123Z',
          method: 'INVITE',
          from: '1000',
          to: '1001',
          callId: 'call-1',
          direction: 'in',
          statusCode: '',
          rawJson: JSON.stringify({
            layers: {
              'frame.time_epoch': ['1777802400.123456'],
              'sip.msg_hdr': ['INVITE sip:1001@pbx.local SIP/2.0\r\nFrom: <sip:1000@carrier.local>\r\nTo: <sip:1001@pbx.local>'],
              'sip.msg_body': ['v=0\r\no=- 0 0 IN IP4 127.0.0.1'],
            },
          }),
        },
      },
    ]);

    const moduleRef = await Test.createTestingModule({ providers: [CaptureService, { provide: DataSource, useValue: mockDataSource }] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    const pcap = await service.exportBulkPcap({});

    expect(pcap.length).toBeGreaterThan(24 + 16);
    expect(pcap.readUInt32LE(0)).toBe(0xa1b2c3d4);
    expect(pcap.readUInt16LE(4)).toBe(2);
    expect(pcap.readUInt16LE(6)).toBe(4);
    expect(pcap.readUInt32LE(20)).toBe(101);

    const tsSec = pcap.readUInt32LE(24);
    const tsUsec = pcap.readUInt32LE(28);
    const inclLen = pcap.readUInt32LE(32);
    const origLen = pcap.readUInt32LE(36);
    expect(tsSec).toBe(1777802400);
    expect(tsUsec).toBe(123456);
    expect(inclLen).toBe(origLen);
    expect(inclLen).toBeGreaterThan(28);

    // First nibble = IPv4 version (4), and UDP protocol = 17.
    const packetStart = 24 + 16;
    expect((pcap[packetStart] >> 4) & 0x0f).toBe(4);
    expect(pcap[packetStart + 9]).toBe(17);

    // Packet record should not be truncated.
    expect(packetStart + inclLen).toBe(pcap.length);
  });
});
