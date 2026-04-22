import { Test } from '@nestjs/testing';
import { createClient } from 'redis';
import { CaptureService } from './capture.service';

jest.mock('redis', () => ({
  createClient: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env, REDIS_HOST: '127.0.0.1', REDIS_PORT: '6380' };
    (createClient as jest.Mock).mockReturnValue(mockRedis);
  });

  afterAll(() => {
    process.env = env;
  });

  it('initializes redis on module init', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService] }).compile();
    const service = moduleRef.get(CaptureService);

    await service.onModuleInit();

    expect(createClient).toHaveBeenCalledWith({
      socket: {
        host: '127.0.0.1',
        port: 6380,
      },
    });
    expect(mockRedis.connect).toHaveBeenCalled();
  });

  it('parseSipPacket maps tshark ek payload into dto', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService] }).compile();
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
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService] }).compile();
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

    const moduleRef = await Test.createTestingModule({ providers: [CaptureService] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    const packets = await service.getBulkPackets({ method: 'INVITE' });
    expect(packets).toHaveLength(1);
    expect(packets[0]).toEqual(expect.objectContaining({ id: '1-0', callId: 'call-1', method: 'INVITE', statusCode: 200 }));

    const dialogPackets = await service.getDialogPackets('call-2');
    expect(dialogPackets).toHaveLength(1);
    expect(dialogPackets[0]).toEqual(expect.objectContaining({ id: '2-0', direction: 'out' }));
  });

  it('disconnects redis on module destroy', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CaptureService] }).compile();
    const service = moduleRef.get(CaptureService);
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(mockRedis.disconnect).toHaveBeenCalled();
  });
});
