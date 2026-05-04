import { publishNodeTelemetry, publishCallEndTelemetry, publishSipStatus, publishSipTraffic, publishCallEvent } from './telemetry';
import { publish } from './redis';

jest.mock('./redis', () => ({
  publish: jest.fn(),
}));

describe('telemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishNodeTelemetry: publishes with correct channel and valid JSON payload', async () => {
    await publishNodeTelemetry(
      { channelId: 'chan-123', flow: { id: 1 } } as any,
      { nodeKey: 'node-456', type: 'menu' } as any,
      'started',
      { meta: true }
    );
    expect(publish).toHaveBeenCalledWith('callytics:call-timeline', expect.objectContaining({
      callId: 'chan-123',
      flowId: 1,
      nodeId: 'node-456',
      nodeType: 'menu',
      status: 'started',
      meta: { meta: true },
    }));
  });

  it('publishCallEndTelemetry: publishes with correct channel', async () => {
    await publishCallEndTelemetry('call-1', 9, '1234');
    expect(publish).toHaveBeenCalledWith('callytics:call-timeline', expect.objectContaining({
      callId: 'call-1',
      flowId: 9,
      nodeId: 'hangup',
      status: 'completed',
    }));
  });

  it('publishSipStatus: publishes endpoints', async () => {
    await publishSipStatus([]);
    expect(publish).toHaveBeenCalledWith('callytics:sip-status', expect.objectContaining({
      endpoints: [],
    }));
  });

  it('publishSipTraffic: publishes traffic', async () => {
    await publishSipTraffic({ method: 'INVITE', direction: 'inbound' } as any);
    expect(publish).toHaveBeenCalledWith('callytics:sip-traffic', expect.objectContaining({
      method: 'INVITE', direction: 'inbound',
    }));
  });

  it('publishCallEvent: publishes call event', async () => {
    await publishCallEvent({ callId: '123', type: 'started', caller: '100' } as any);
    expect(publish).toHaveBeenCalledWith('callytics:call-events', expect.objectContaining({
      callId: '123', type: 'started', caller: '100',
    }));
  });

  it('catches and handles redis.publish throws', async () => {
    (publish as jest.Mock).mockRejectedValueOnce(new Error('redis is down'));
    await expect(publishNodeTelemetry({ channelId: 'chan-1', flow: { id: 1 } } as any, { nodeKey: 'n1', type: 'play' } as any, 'started')).resolves.not.toThrow();
    
    (publish as jest.Mock).mockRejectedValueOnce(new Error('redis is down'));
    await expect(publishCallEndTelemetry('1', 1, '1')).resolves.not.toThrow();

    (publish as jest.Mock).mockRejectedValueOnce(new Error('redis is down'));
    await expect(publishSipStatus([])).resolves.not.toThrow();
  });
});
