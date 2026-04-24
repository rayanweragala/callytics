import * as fs from 'fs';
import { AsteriskLogsService } from './asterisk-logs.service';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

describe('AsteriskLogsService', () => {
  let service: AsteriskLogsService;
  const existsSyncMock = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
  const readFileSyncMock = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

  beforeEach(() => {
    service = new AsteriskLogsService();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-23T10:00:00.000Z'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('parses format A line without call context id', () => {
    const line = '[Apr 23 09:15:30] ERROR[1201] res_pjsip.c: Registration from \'<sip:1001@10.0.0.8>\' failed';

    const parsed = (service as any).parseLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed.level).toBe('ERROR');
    expect(parsed.module).toBe('res_pjsip.c');
    expect(parsed.message).toBe('Registration from \'<sip:1001@10.0.0.8>\' failed');
    expect(parsed.timestamp.startsWith('2026-')).toBe(true);
    expect(Number.isNaN(new Date(parsed.timestamp).getTime())).toBe(false);
  });

  it('parses format B line with call context id and keeps channel as thread id only', () => {
    const line = '[Apr 23 09:16:00] WARNING[4512][C-00000001] app_dial.c: Everyone is busy/congested at this time';

    const parsed = (service as any).parseLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed.level).toBe('WARNING');
    expect(parsed.module).toBe('app_dial.c');
    expect(parsed.message).toBe('Everyone is busy/congested at this time');
    expect(parsed.timestamp.startsWith('2026-')).toBe(true);
    expect(Number.isNaN(new Date(parsed.timestamp).getTime())).toBe(false);
    expect(parsed.channel).toBe('[4512]');
  });

  it('sets translation when message matches a known translation rule', () => {
    const line = '[Apr 23 09:17:00] ERROR[2311] pjsip_distributor.c: No matching endpoint found';

    const parsed = (service as any).parseLine(line);

    expect(parsed.translation).toBe('Incoming call from an unknown SIP address — no matching extension or trunk');
  });

  it('keeps translation undefined when no rule matches', () => {
    const line = '[Apr 23 09:18:00] NOTICE[2311] app_queue.c: Queue metrics updated';

    const parsed = (service as any).parseLine(line);

    expect(parsed.translation).toBeUndefined();
  });

  it('filters out empty/whitespace lines from results', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '   ',
      '',
      '[Apr 23 09:19:00] NOTICE[3311] logger.c: Asterisk Ready',
      '      ',
    ].join('\n'));

    const result = service.getLogs('all', '', 100, 0);

    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].message).toBe('Asterisk Ready');
  });

  it('skips non-asterisk lines instead of emitting epoch timestamps', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[Apr 23 09:19:00] NOTICE[3311] logger.c: Asterisk Ready',
      'SIP/2.0 200 OK',
      'Date: Thu, 23 Apr 2026 17:20:37 GMT',
      'Content-Length:  0',
    ].join('\n'));

    const result = service.getLogs('all', '', 100, 0);

    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].timestamp).not.toBe('1970-01-01T00:00:00.000Z');
    expect(result.entries[0].message).toBe('Asterisk Ready');
  });

  it('returns empty result when log file does not exist', () => {
    existsSyncMock.mockReturnValue(false);

    const result = service.getLogs();

    expect(result).toEqual({
      entries: [],
      total: 0,
      fileExists: false,
    });
  });
});
