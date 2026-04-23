import { DiagnosticsGateway } from './diagnostics.gateway';

describe('DiagnosticsGateway capture relay', () => {
  it('broadcastSipPacket emits sip:packet to capture-room', () => {
    const diagnosticsService = { setGateway: jest.fn() } as any;
    const captureService = { persistPacket: jest.fn().mockResolvedValue(undefined) } as any;
    const gateway = new DiagnosticsGateway(diagnosticsService, captureService);
    const emit = jest.fn();
    (gateway as any).server = { to: jest.fn(() => ({ emit })) };

    gateway.broadcastSipPacket({
      id: '1-0',
      timestamp: '10:42:57.000',
      method: 'INVITE',
      from: 'a',
      to: 'b',
      callId: 'call-1',
      direction: 'in',
      rawJson: '{}',
    });

    expect((gateway as any).server.to).toHaveBeenCalledWith('capture-room');
    expect(emit).toHaveBeenCalledWith('sip:packet', expect.objectContaining({ callId: 'call-1' }));
  });

  it('replays last packets on capture subscribe', async () => {
    const diagnosticsService = { setGateway: jest.fn() } as any;
    const captureService = { persistPacket: jest.fn().mockResolvedValue(undefined) } as any;
    const gateway = new DiagnosticsGateway(diagnosticsService, captureService);
    (gateway as any).captureRedis = {
      isOpen: true,
      xRevRange: jest.fn().mockResolvedValue([
        {
          id: '2-0',
          message: {
            timestamp: '10:42:58.000',
            method: '200',
            from: 'a',
            to: 'b',
            callId: 'call-1',
            direction: 'in',
            statusCode: '200',
            rawJson: '{}',
          },
        },
      ]),
    };

    const client = {
      join: jest.fn(),
      emit: jest.fn(),
    } as any;

    gateway.handleCaptureSubscribe(client);
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.join).toHaveBeenCalledWith('capture-room');
    expect(client.emit).toHaveBeenCalledWith('sip:packet', expect.objectContaining({
      id: '2-0',
      callId: 'call-1',
    }));
  });
});
