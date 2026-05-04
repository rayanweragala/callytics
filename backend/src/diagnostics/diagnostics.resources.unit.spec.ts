import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as net from 'node:net';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';
import { createClient } from 'redis';
import { DiagnosticsService } from './diagnostics.service';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';

jest.mock('node:net');
jest.mock('node:os');
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
    },
  };
});
jest.mock('node:child_process', () => ({
  execFile: jest.fn(),
}));
jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

const PROC_STAT_FIRST = 'cpu  100 0 50 800 50 0 0 0 0 0\n';
const PROC_STAT_SECOND = 'cpu  110 0 55 870 55 0 0 0 0 0\n';
const PROC_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:    1000     10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0: 5000000   5000    0    0    0     0          0         0  2000000    2000    0    0    0     0       0          0
  eth1: 1000000   1000    0    0    0     0          0         0   500000     500    0    0    0     0       0          0
`;
const DF_OUTPUT = `Filesystem     1K-blocks     Used Available Use% Mounted on
/dev/sda1      100000000 40000000  60000000  40% /
`;

function buildAmiSocketMock(events: string[]) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockSocket = {
    setTimeout: jest.fn(),
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      if (event === 'connect') {
        setTimeout(() => cb(), 0);
      }
    }),
    write: jest.fn((data: string) => {
      if (data.includes('Login') || data.includes('CoreShowChannels')) {
        setTimeout(() => {
          for (const eventRaw of events) {
            const dataListeners = listeners['data'] || [];
            for (const listener of dataListeners) {
              listener(Buffer.from(eventRaw));
            }
          }
        }, 0);
      }
    }),
    end: jest.fn(),
  };

  return mockSocket;
}

describe('DiagnosticsService — getResources()', () => {
  let service: DiagnosticsService;
  const mockRepo = { findOne: jest.fn(), find: jest.fn() };
  const mockDataSource = { query: jest.fn() };
  const mockAsterisk = {
    checkAmiConnection: jest.fn(),
    qualifyEndpoint: jest.fn(),
    getPjsipEndpoints: jest.fn(),
  };
  const mockRedisSubscriber = {
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1);
    (createClient as unknown as jest.Mock).mockReturnValue(mockRedisSubscriber);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiagnosticsService,
        { provide: getRepositoryToken(SipTrunkEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsterisk },
      ],
    }).compile();

    service = module.get(DiagnosticsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  function mockProcReads(options?: { procStatError?: Error; procNetDevError?: Error }) {
    let procStatReads = 0;
    (fs.promises.readFile as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/proc/stat') {
        if (options?.procStatError) {
          throw options.procStatError;
        }
        procStatReads += 1;
        return procStatReads === 1 ? PROC_STAT_FIRST : PROC_STAT_SECOND;
      }
      if (path === '/proc/net/dev') {
        if (options?.procNetDevError) {
          throw options.procNetDevError;
        }
        return PROC_NET_DEV;
      }
      throw new Error(`Unexpected path: ${path}`);
    });
  }

  it('all metrics succeed — returns correct shape', async () => {
    mockProcReads();

    (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
    (os.freemem as jest.Mock).mockReturnValue(4 * 1024 ** 3);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: null, stdout: string) => void) => {
        callback(null, DF_OUTPUT);
      },
    );

    // AMI CoreShowChannels — 2 channels then Complete
    const loginSuccess = 'Response: Success\r\nMessage: Authentication accepted\r\n\r\n';
    const channel1 = 'Event: CoreShowChannel\r\nActionID: channels-1\r\nChannel: PJSIP/1001\r\n\r\n';
    const channel2 = 'Event: CoreShowChannel\r\nActionID: channels-1\r\nChannel: PJSIP/1002\r\n\r\n';
    const complete = 'Event: CoreShowChannelsComplete\r\nActionID: channels-1\r\nListItems: 2\r\n\r\n';
    const mockSocket = buildAmiSocketMock([loginSuccess, channel1, channel2, complete]);
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    jest.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);

    const result = await service.getResources();

    expect('error' in result.cpu).toBe(false);
    if ('usage' in result.cpu) {
      expect(result.cpu.usage).toBeGreaterThanOrEqual(0);
      expect(result.cpu.usage).toBeLessThanOrEqual(100);
    }

    expect('error' in result.memory).toBe(false);
    if ('total' in result.memory) {
      expect(result.memory.total).toBe(8 * 1024 ** 3);
      expect(result.memory.usagePercent).toBe(50);
    }

    expect('error' in result.disk).toBe(false);
    if ('total' in result.disk) {
      expect(result.disk.total).toBe(100000000 * 1024);
      expect(result.disk.usagePercent).toBe(40);
    }

    expect('error' in result.network).toBe(false);
    if ('bytesSent' in result.network) {
      expect(result.network.bytesReceived).toBe(6000000);
      expect(result.network.bytesSent).toBe(2500000);
    }
  });

  it('CPU /proc/stat read throws — returns error for cpu only', async () => {
    mockProcReads({ procStatError: new Error('ENOENT: /proc/stat') });

    (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
    (os.freemem as jest.Mock).mockReturnValue(4 * 1024 ** 3);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: null, stdout: string) => void) => {
        callback(null, DF_OUTPUT);
      },
    );

    const loginSuccess = 'Response: Success\r\nMessage: Authentication accepted\r\n\r\n';
    const complete = 'Event: CoreShowChannelsComplete\r\nActionID: channels-1\r\nListItems: 0\r\n\r\n';
    const mockSocket = buildAmiSocketMock([loginSuccess, complete]);
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    const result = await service.getResources();

    expect('error' in result.cpu).toBe(true);
    expect('error' in result.memory).toBe(false);
    expect('error' in result.disk).toBe(false);
    expect('error' in result.network).toBe(false);
  });

  it('memory read with os returning zeros does not error', async () => {
    mockProcReads();

    (os.totalmem as jest.Mock).mockReturnValue(0);
    (os.freemem as jest.Mock).mockReturnValue(0);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: null, stdout: string) => void) => {
        callback(null, DF_OUTPUT);
      },
    );

    const loginSuccess = 'Response: Success\r\nMessage: Authentication accepted\r\n\r\n';
    const complete = 'Event: CoreShowChannelsComplete\r\nActionID: channels-1\r\nListItems: 0\r\n\r\n';
    const mockSocket = buildAmiSocketMock([loginSuccess, complete]);
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    jest.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);

    const result = await service.getResources();

    expect('error' in result.memory).toBe(false);
    if ('total' in result.memory) {
      expect(result.memory.total).toBe(0);
      expect(result.memory.usagePercent).toBeNaN();
    }
  });

  it('disk df parse fails — returns error for disk only', async () => {
    mockProcReads();

    (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
    (os.freemem as jest.Mock).mockReturnValue(4 * 1024 ** 3);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: Error) => void) => {
        callback(new Error('df: command not found'));
      },
    );

    const loginSuccess = 'Response: Success\r\nMessage: Authentication accepted\r\n\r\n';
    const complete = 'Event: CoreShowChannelsComplete\r\nActionID: channels-1\r\nListItems: 0\r\n\r\n';
    const mockSocket = buildAmiSocketMock([loginSuccess, complete]);
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    jest.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);

    const result = await service.getResources();

    expect('error' in result.disk).toBe(true);
    expect('error' in result.cpu).toBe(false);
    expect('error' in result.memory).toBe(false);
    expect('error' in result.network).toBe(false);
  });

  it('AMI CoreShowChannels times out — returns error for asterisk only', async () => {
    mockProcReads();

    (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
    (os.freemem as jest.Mock).mockReturnValue(4 * 1024 ** 3);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: null, stdout: string) => void) => {
        callback(null, DF_OUTPUT);
      },
    );

    // Simulate timeout by triggering socket timeout callback synchronously
    const timeoutListeners: (() => void)[] = [];
    const mockSocket = {
      setTimeout: jest.fn((_ms: number, cb: () => void) => timeoutListeners.push(cb)),
      on: jest.fn((event: string, cb: () => void) => {
        if (event === 'connect') {
          setTimeout(() => cb(), 0);
        }
      }),
      write: jest.fn(() => {
        // trigger timeout immediately
        for (const cb of timeoutListeners) cb();
      }),
      end: jest.fn(),
    };
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    jest.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);

    const result = await service.getResources();

    expect('error' in result.asterisk).toBe(true);
    expect('error' in result.cpu).toBe(false);
    expect('error' in result.memory).toBe(false);
    expect('error' in result.disk).toBe(false);
    expect('error' in result.network).toBe(false);
  });

  it('network /proc/net/dev read fails — returns error for network only', async () => {
    mockProcReads({ procNetDevError: new Error('ENOENT: /proc/net/dev') });

    (os.totalmem as jest.Mock).mockReturnValue(8 * 1024 ** 3);
    (os.freemem as jest.Mock).mockReturnValue(4 * 1024 ** 3);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: null, stdout: string) => void) => {
        callback(null, DF_OUTPUT);
      },
    );

    const loginSuccess = 'Response: Success\r\nMessage: Authentication accepted\r\n\r\n';
    const complete = 'Event: CoreShowChannelsComplete\r\nActionID: channels-1\r\nListItems: 0\r\n\r\n';
    const mockSocket = buildAmiSocketMock([loginSuccess, complete]);
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    jest.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);

    const result = await service.getResources();

    expect('error' in result.network).toBe(true);
    expect('error' in result.cpu).toBe(false);
    expect('error' in result.memory).toBe(false);
    expect('error' in result.disk).toBe(false);
  });

  it('all metrics fail simultaneously — returns all errors', async () => {
    (fs.promises.readFile as jest.Mock).mockRejectedValue(new Error('read failed'));
    (os.totalmem as jest.Mock).mockImplementation(() => { throw new Error('os failed'); });
    (os.freemem as jest.Mock).mockReturnValue(0);

    (childProcess.execFile as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _args: string[], _opts: object, callback: (err: Error) => void) => {
        callback(new Error('df failed'));
      },
    );

    const errorListeners: ((err: Error) => void)[] = [];
    const mockSocket = {
      setTimeout: jest.fn(),
      on: jest.fn((event: string, cb: (err: Error) => void) => {
        if (event === 'connect') {
          setTimeout(() => cb(new Error()), 0);
          return;
        }
        if (event === 'error') errorListeners.push(cb);
      }),
      write: jest.fn(() => {
        for (const cb of errorListeners) cb(new Error('AMI connection refused'));
      }),
      end: jest.fn(),
    };
    (net.createConnection as unknown as jest.Mock).mockReturnValue(mockSocket);

    const result = await service.getResources();

    expect('error' in result.cpu).toBe(true);
    expect('error' in result.memory).toBe(true);
    expect('error' in result.disk).toBe(true);
    expect('error' in result.asterisk).toBe(true);
    expect('error' in result.network).toBe(true);
  });
});
