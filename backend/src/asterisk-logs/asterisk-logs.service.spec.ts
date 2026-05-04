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

  it('parses format B line with call context id and keeps channel as call context id', () => {
    const line = '[Apr 23 09:16:00] WARNING[4512][C-00000001] app_dial.c: Everyone is busy/congested at this time';

    const parsed = (service as any).parseLine(line);

    expect(parsed).not.toBeNull();
    expect(parsed.level).toBe('WARNING');
    expect(parsed.module).toBe('app_dial.c');
    expect(parsed.message).toBe('Everyone is busy/congested at this time');
    expect(parsed.timestamp.startsWith('2026-')).toBe(true);
    expect(Number.isNaN(new Date(parsed.timestamp).getTime())).toBe(false);
    expect(parsed.channel).toBe('[C-00000001]');
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

    const result = service.getLogs('all', '', true, '', '', '', 100, 0);

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

    const result = service.getLogs('all', '', true, '', '', '', 100, 0);

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

  it('matches search against message and module only', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[Apr 23 09:19:00] NOTICE[3311] logger.c: Asterisk Ready',
      '[Apr 23 09:20:00] NOTICE[3312] pbx.c: Dialplan executed',
    ].join('\n'));

    const byMessage = service.getLogs('all', 'dialplan', false, '', '', '', 100, 0);
    const byModule = service.getLogs('all', 'logger.c', false, '', '', '', 100, 0);
    const noRawOnlyHit = service.getLogs('all', 'notice[3311]', false, '', '', '', 100, 0);

    expect(byMessage.total).toBe(1);
    expect(byMessage.entries[0].message).toBe('Dialplan executed');
    expect(byModule.total).toBe(1);
    expect(byModule.entries[0].module).toBe('logger.c');
    expect(noRawOnlyHit.total).toBe(0);
  });

  it('excludes known noise modules when hideNoise=true', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[Apr 23 09:19:00] NOTICE[3311] logger.c: Asterisk Ready',
      '[Apr 23 09:19:05] NOTICE[3312] manager.c: AMI Login from 127.0.0.1',
      '[Apr 23 09:19:06] NOTICE[3313] res_pjsip_logger.c: <--- Received SIP request --->',
    ].join('\n'));

    const hidden = service.getLogs('all', '', true, '', '', '', 100, 0);
    const shown = service.getLogs('all', '', false, '', '', '', 100, 0);

    expect(hidden.total).toBe(1);
    expect(hidden.entries[0].module).toBe('logger.c');
    expect(shown.total).toBe(3);
  });

  it('filters by uniqueid and time range for call drill-down', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[2026-04-23T09:14:57.000Z] NOTICE[1000][C-00000010] app_dial.c: Before window',
      '[2026-04-23T09:14:59.000Z] NOTICE[1001][C-00000010] app_dial.c: In window start',
      '[2026-04-23T09:15:01.000Z] NOTICE[1002][C-00000011] app_dial.c: Different call',
      '[2026-04-23T09:15:03.000Z] NOTICE[1003][C-00000010] app_dial.c: In window end',
      '[2026-04-23T09:15:06.000Z] NOTICE[1004][C-00000010] app_dial.c: After window',
    ].join('\n'));

    const result = service.getLogs(
      'all',
      '',
      false,
      'C-00000010',
      '2026-04-23T09:14:58.000Z',
      '2026-04-23T09:15:04.000Z',
      100,
      0,
    );

    expect(result.total).toBe(2);
    expect(result.entries.map((entry) => entry.message)).toEqual([
      'In window end',
      'In window start',
    ]);
  });

  it('matches numeric uniqueid call family even when suffix changes between events', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[2026-04-24T15:25:50.000Z] WARNING[355][C-00000001] res_stasis_playback.c: 1777044349.3: Playback failed for sound:callytics/3',
      '[2026-04-24T15:25:51.000Z] WARNING[356][C-00000002] res_stasis_playback.c: 1777044350.1: Playback failed for sound:callytics/4',
    ].join('\n'));

    const result = service.getLogs(
      'all',
      '',
      false,
      '1777044349.0',
      '2026-04-24T15:25:47.000Z',
      '2026-04-24T15:25:55.000Z',
      100,
      0,
    );

    expect(result.total).toBe(1);
    expect(result.entries[0].message).toContain('1777044349.3');
  });

  it('includes correlated per-call context logs when uniqueid appears only in subset of lines', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[2026-04-24T15:49:35.000Z] WARNING[2104][C-00000002] res_stasis_playback.c: 1777045766.8: Playback failed for sound:callytics/3',
      '[2026-04-24T15:49:35.000Z] VERBOSE[2098][C-00000002] bridge_channel.c: Channel PJSIP/2001-00000001 left \'softmix\' stasis-bridge <5020596b-7677-4979-baf6-b421dabbb6ff>',
      '[2026-04-24T15:49:35.000Z] VERBOSE[2100] bridge_channel.c: Channel Recorder/ARI-00000002;2 left \'simple_bridge\' stasis-bridge <5020596b-7677-4979-baf6-b421dabbb6ff>',
      '[2026-04-24T15:49:26.000Z] VERBOSE[2096][C-00000002] pbx.c: Executing [1234@callytics-inbound:1] Stasis("PJSIP/2001-00000001", "callytics") in new stack',
      '[2026-04-24T15:49:26.000Z] VERBOSE[3000][C-00000077] pbx.c: Executing [2222@callytics-inbound:1] Stasis("PJSIP/9999-00000001", "callytics") in new stack',
    ].join('\n'));

    const result = service.getLogs(
      'all',
      '',
      false,
      '1777045766.5',
      '2026-04-24T15:49:24.000Z',
      '2026-04-24T15:49:37.000Z',
      100,
      0,
    );

    expect(result.total).toBe(4);
    expect(result.entries.some((entry) => entry.message.includes('1777045766.8'))).toBe(true);
    expect(result.entries.some((entry) => entry.message.includes('Executing [1234@callytics-inbound:1]'))).toBe(true);
    expect(result.entries.some((entry) => entry.raw.includes('Recorder/ARI-00000002;2 left'))).toBe(true);
    expect(result.entries.some((entry) => entry.raw.includes('C-00000077'))).toBe(false);
  });

  it('uses caller and destination context to include conference call legs when uniqueid is not present in log lines', () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue([
      '[2026-04-26T10:11:54.000Z] VERBOSE[6310][C-00000001] pbx.c: Executing [3333@callytics-inbound:1] Stasis("PJSIP/2001-00000000", "callytics") in new stack',
      '[2026-04-26T10:11:55.000Z] VERBOSE[6311][C-00000002] pbx.c: Executing [3333@callytics-inbound:1] Stasis("PJSIP/1234-00000001", "callytics") in new stack',
      '[2026-04-26T10:11:56.000Z] VERBOSE[6312][C-00000001] bridge_channel.c: Channel PJSIP/2001-00000000 joined softmix bridge',
      '[2026-04-26T10:11:57.000Z] VERBOSE[6313][C-00000002] bridge_channel.c: Channel PJSIP/1234-00000001 joined softmix bridge',
      '[2026-04-26T10:11:58.000Z] VERBOSE[6314][C-00000077] pbx.c: Executing [4444@callytics-inbound:1] Stasis("PJSIP/9999-00000002", "callytics") in new stack',
    ].join('\n'));

    const result = service.getLogs(
      'all',
      '',
      false,
      '1777202327.0',
      '2026-04-26T10:11:50.000Z',
      '2026-04-26T10:12:05.000Z',
      100,
      0,
      '2001',
      '3333',
    );

    expect(result.total).toBe(4);
    expect(result.entries.some((entry) => entry.raw.includes('PJSIP/2001-00000000'))).toBe(true);
    expect(result.entries.some((entry) => entry.raw.includes('PJSIP/1234-00000001'))).toBe(true);
    expect(result.entries.some((entry) => entry.raw.includes('PJSIP/9999-00000002'))).toBe(false);
  });
});
