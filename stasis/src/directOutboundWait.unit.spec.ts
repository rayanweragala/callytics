import { EventEmitter } from 'events';
import { resolveDirectOutboundWaiter } from './directOutboundManager';
import {
  DEFAULT_DIRECT_OUTBOUND_TIMEOUT_MS,
  resolveDirectOutboundTimeoutMs,
  waitForDirectOutboundAnswer,
} from './directOutboundWait';

function createClient() {
  const emitter = new EventEmitter();
  return {
    emitter,
    client: {
      on: (event: string, listener: (payload: never) => void) => void emitter.on(event, listener),
      removeListener: (event: string, listener: (payload: never) => void) =>
        void emitter.removeListener(event, listener),
    },
  };
}

const logger = { warn: jest.fn(), error: jest.fn() };

const baseParams = (token: string) => ({
  token,
  inboundChannelId: 'inbound-1',
  outboundChannelId: `${token}-leg`,
  timeoutMs: 5000,
});

describe('resolveDirectOutboundTimeoutMs', () => {
  it('uses the default for a missing value', () => {
    expect(resolveDirectOutboundTimeoutMs(undefined)).toBe(DEFAULT_DIRECT_OUTBOUND_TIMEOUT_MS);
  });

  it('uses the default for garbage instead of producing NaN', () => {
    expect(resolveDirectOutboundTimeoutMs('abc')).toBe(DEFAULT_DIRECT_OUTBOUND_TIMEOUT_MS);
    expect(Number.isNaN(resolveDirectOutboundTimeoutMs('abc'))).toBe(false);
  });

  it('reads a valid value', () => {
    expect(resolveDirectOutboundTimeoutMs('45000')).toBe(45000);
  });
});

describe('waitForDirectOutboundAnswer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports the originate error instead of swallowing it', async () => {
    const { client } = createClient();
    const result = await waitForDirectOutboundAnswer(client, logger, {
      ...baseParams('t-failed'),
      originate: async () => {
        throw new Error('Unable to create channel');
      },
    });

    expect(result).toEqual({
      answered: false,
      reason: 'failed',
      detail: 'originate failed: Unable to create channel',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unable to create channel'),
      expect.any(Error),
    );
  });

  it('fails immediately with the hangup cause when the outbound leg is destroyed before answer', async () => {
    const { client, emitter } = createClient();
    const params = baseParams('t-destroyed');
    const started = Date.now();
    const pending = waitForDirectOutboundAnswer(client, logger, {
      ...params,
      originate: async () => {
        setImmediate(() =>
          emitter.emit('ChannelDestroyed', {
            channel: { id: params.outboundChannelId },
            cause: 34,
            cause_txt: 'Circuit/channel congestion',
          }),
        );
      },
    });

    const result = await pending;
    expect(result).toEqual({
      answered: false,
      reason: 'destroyed',
      detail: 'Circuit/channel congestion (cause 34)',
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('ignores destroy events of other channels', async () => {
    const { client, emitter } = createClient();
    const params = baseParams('t-other');
    const pending = waitForDirectOutboundAnswer(client, logger, {
      ...params,
      originate: async () => {
        setImmediate(() => {
          emitter.emit('ChannelDestroyed', { channel: { id: 'unrelated' }, cause: 16 });
          resolveDirectOutboundWaiter(params.token, { id: 'answered-leg', hangup: jest.fn() });
        });
      },
    });

    await expect(pending).resolves.toEqual(expect.objectContaining({ answered: true }));
  });

  it('fails when the caller hangs up', async () => {
    const { client, emitter } = createClient();
    const pending = waitForDirectOutboundAnswer(client, logger, {
      ...baseParams('t-caller'),
      originate: async () => {
        setImmediate(() => emitter.emit('StasisEnd', { channel: { id: 'inbound-1' } }));
      },
    });

    await expect(pending).resolves.toEqual({ answered: false, reason: 'caller_disconnected' });
  });

  it('times out when nothing happens and removes its listeners', async () => {
    const { client, emitter } = createClient();
    const result = await waitForDirectOutboundAnswer(client, logger, {
      ...baseParams('t-timeout'),
      timeoutMs: 20,
      originate: async () => undefined,
    });

    expect(result).toEqual({ answered: false, reason: 'timeout' });
    expect(emitter.listenerCount('ChannelDestroyed')).toBe(0);
    expect(emitter.listenerCount('StasisEnd')).toBe(0);
  });
});
