import { runInboundCall, type InboundCallDeps, type InboundChannel } from './inboundCall';
import { resolveStasisChannel } from './lib/ariChannel';
import { addSession, getSession, removeSession } from './callSession';
import type { Flow } from './flowLoader';

const flow: Flow = {
  id: 7,
  name: 'Concurrent flow',
  versionId: 1,
  nodes: [{ nodeKey: 'start', type: 'start', label: 'Start', config: {} }],
  edges: [],
} as Flow;

function createChannel(id: string) {
  return {
    id,
    answer: jest.fn().mockResolvedValue(undefined),
    hangup: jest.fn().mockResolvedValue(undefined),
  } satisfies InboundChannel;
}

function createDeps(overrides: Partial<InboundCallDeps> = {}): InboundCallDeps {
  return {
    ariApp: 'callytics',
    failedCalls: new Set<string>(),
    publishSipTraffic: jest.fn().mockResolvedValue(undefined),
    publishCallEvent: jest.fn().mockResolvedValue(undefined),
    resolveInboundRoute: jest.fn().mockResolvedValue({ did: '100', flowId: 7 }),
    loadFlowById: jest.fn().mockResolvedValue(flow),
    loadFlow: jest.fn().mockResolvedValue(flow),
    createInboundBridge: jest.fn(async (_client, channelId: string) => ({ id: `bridge-${channelId}` })),
    destroyInboundBridge: jest.fn().mockResolvedValue(undefined),
    addSession,
    removeSession,
    runFlow: jest.fn().mockResolvedValue({ status: 'completed' }),
    ...overrides,
  };
}

const client = { applications: { subscribe: jest.fn().mockResolvedValue(undefined) } };

function stasisEvent(callerNumber: string, did: string) {
  return {
    args: [],
    channel: {
      caller: { number: callerNumber },
      dnid: did,
      dialplan: { context: 'callytics-inbound', exten: did },
    },
  };
}

describe('two simultaneous inbound calls', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps a separate session, channel and bridge per call', async () => {
    const channelA = createChannel('chan-a');
    const channelB = createChannel('chan-b');
    const seen: Array<{ channelId: string; callerNumber: string; bridgeId: string | null }> = [];

    // Both calls reach the flow runner at the same time before either one finishes.
    let release: () => void = () => undefined;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runFlow = jest.fn(async (channel: InboundChannel, session) => {
      seen.push({
        channelId: channel.id,
        callerNumber: session.callerNumber,
        bridgeId: session.inboundBridge?.id ?? null,
      });
      if (seen.length === 2) {
        release();
      }
      await bothStarted;
      return { status: 'completed' as const };
    });
    const deps = createDeps({ runFlow });

    await Promise.all([
      runInboundCall(client, stasisEvent('1001', '100'), channelA, '100', deps),
      runInboundCall(client, stasisEvent('1002', '100'), channelB, '100', deps),
    ]);

    expect(channelA.answer).toHaveBeenCalledTimes(1);
    expect(channelB.answer).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(
      expect.arrayContaining([
        { channelId: 'chan-a', callerNumber: '1001', bridgeId: 'bridge-chan-a' },
        { channelId: 'chan-b', callerNumber: '1002', bridgeId: 'bridge-chan-b' },
      ]),
    );
    expect(getSession('chan-a')?.callerNumber).toBe('1001');
    expect(getSession('chan-b')?.callerNumber).toBe('1002');
    removeSession('chan-a');
    removeSession('chan-b');
  });

  it('a failure in one call does not touch the other call', async () => {
    const channelA = createChannel('chan-fail');
    const channelB = createChannel('chan-ok');
    const failedCalls = new Set<string>();
    const runFlow = jest.fn(async (channel: InboundChannel) => {
      if (channel.id === 'chan-fail') {
        throw new Error('boom');
      }
      return { status: 'completed' as const };
    });
    const deps = createDeps({ runFlow, failedCalls });

    await Promise.all([
      runInboundCall(client, stasisEvent('2001', '100'), channelA, '100', deps),
      runInboundCall(client, stasisEvent('2002', '100'), channelB, '100', deps),
    ]);

    expect(failedCalls.has('chan-fail')).toBe(true);
    expect(failedCalls.has('chan-ok')).toBe(false);
    expect(channelA.hangup).toHaveBeenCalled();
    expect(channelB.hangup).not.toHaveBeenCalled();
    expect(getSession('chan-ok')).toBeDefined();
    removeSession('chan-ok');
  });
});

describe('resolveStasisChannel', () => {
  const event = { channel: { id: 'chan-x' } };

  it('returns a proper Channel instance unchanged', () => {
    const instance = createChannel('chan-x');
    expect(resolveStasisChannel(client, event, instance)).toBe(instance);
  });

  it('unwraps the plain { channel, replace_channel } object ari-client passes for two-resource events', () => {
    const instance = createChannel('chan-x');
    const resources = { channel: instance, replace_channel: createChannel('chan-old') };
    expect(resolveStasisChannel(client, event, resources)).toBe(instance);
  });

  it('rebuilds a Channel from the event when no instance is available', () => {
    const rebuilt = createChannel('chan-x');
    const factory = jest.fn().mockReturnValue(rebuilt);
    expect(resolveStasisChannel({ Channel: factory }, event, {})).toBe(rebuilt);
    expect(factory).toHaveBeenCalledWith('chan-x', event.channel);
  });

  it('throws a descriptive error instead of "channel.answer is not a function"', () => {
    expect(() => resolveStasisChannel({}, event, {})).toThrow('no usable channel (channelId=chan-x)');
  });

  it('lets a call with a plain resources object run end to end', async () => {
    const instance = createChannel('chan-wrapped');
    const channel = resolveStasisChannel<InboundChannel>(
      client,
      { channel: { id: 'chan-wrapped' } },
      { channel: instance, replace_channel: createChannel('chan-old') },
    );
    await runInboundCall(client, stasisEvent('3001', '100'), channel, '100', createDeps());
    expect(instance.answer).toHaveBeenCalledTimes(1);
    removeSession('chan-wrapped');
  });
});
