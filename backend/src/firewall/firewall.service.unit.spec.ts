import { FirewallGateway } from './firewall.gateway';
import { FirewallService } from './firewall.service';

type QueryArgs = [string, unknown[]?];
type RunCommand = (command: string, args: string[]) => Promise<string>;

describe('FirewallService', () => {
  const gateway = {
    emitBlocked: jest.fn(),
    emitAllowed: jest.fn(),
    emitFeed: jest.fn(),
    emitStats: jest.fn(),
  } as unknown as FirewallGateway;
  const dataSource = { query: jest.fn<Promise<unknown>, QueryArgs>() };
  let service: FirewallService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FirewallService(dataSource as never, gateway);
    jest.spyOn(service as unknown as { runCommand: RunCommand }, 'runCommand').mockResolvedValue('ok');
  });

  it('extracts source IP from the Asterisk 20 failed-for segment', () => {
    const event = service.parseSecurityLog("[Apr 27 09:00:11] NOTICE[70]: res_pjsip/pjsip_distributor.c:688 log_failed_request: Request 'REGISTER' from '<sip:2001@10.20.115.95>' failed for '10.20.115.95:35846' (callid: Zn9BeVRrM4) - Failed to authenticate");

    expect(event).toMatchObject({
      ip: '10.20.115.95',
      username: null,
      kind: 'failed_registration',
      reason: 'failed registration',
    });
    expect(event?.ip).not.toContain('/32');
    expect(event?.timestamp).toContain(String(new Date().getFullYear()));
  });

  it('distinguishes SIP URI IP from source IP when they differ', () => {
    const event = service.parseSecurityLog("[Apr 27 09:00:11] NOTICE[70]: res_pjsip/pjsip_distributor.c:688 log_failed_request: Request 'REGISTER' from '<sip:2001@198.51.100.77>' failed for '10.20.115.95:35846' (callid: Zn9BeVRrM4) - Failed to authenticate");

    expect(event).toMatchObject({ ip: '10.20.115.95', kind: 'failed_registration', reason: 'failed registration' });
    expect(event?.ip).not.toBe('198.51.100.77');
    expect(event?.ip).not.toContain('/32');
  });

  it('uses GeoIP reader data when available', async () => {
    (service as unknown as { geoReader: { country: (ip: string) => { country: { isoCode: string; names: { en: string } } } } }).geoReader = {
      country: () => ({ country: { isoCode: 'LK', names: { en: 'Sri Lanka' } } }),
    };

    const result = await (service as unknown as { lookupCountry: (ip: string) => Promise<{ countryCode: string; countryName: string }> }).lookupCountry('203.0.113.1');

    expect(result).toEqual({ countryCode: 'LK', countryName: 'Sri Lanka' });
  });

  it('blocks when threshold is crossed within the configured window', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT is_whitelisted')) return [];
      if (sql.includes('FROM firewall_config')) {
        return [{ enforcement_mode: 'iptables', threshold: 2, time_window_seconds: 60, block_duration_seconds: 3600, trunk_ceilings: {} }];
      }
      if (sql.includes('INSERT INTO blocked_ips')) {
        return [{ id: 1, ip: '198.51.100.90', country_code: 'unknown', country_name: 'Unknown', attempt_count: 2, reason: 'auth failure', enforcement_mode: 'iptables', expires_at: null, created_at: '2026-04-27T10:00:00.000Z', is_whitelisted: false }];
      }
      if (sql.includes('INSERT INTO firewall_events')) {
        return [{ id: 1, ip: '198.51.100.90', country_code: 'unknown', country_name: 'Unknown', event_type: 'blocked', reason: 'auth failure', detail: '2 attempts', created_at: '2026-04-27T10:00:00.000Z' }];
      }
      return [];
    });

    const first = { ip: '198.51.100.90', username: null, timestamp: '2026-04-27T10:00:00.000Z', kind: 'auth_failure' as const, reason: 'auth failure', detail: 'one' };
    await service.processLogEvent(first);
    await service.processLogEvent({ ...first, timestamp: '2026-04-27T10:00:20.000Z', detail: 'two' });

    expect(gateway.emitBlocked).toHaveBeenCalledWith(expect.objectContaining({ ip: '198.51.100.90', attemptCount: 2 }));
    expect((service as unknown as { runCommand: jest.Mock }).runCommand).toHaveBeenCalledWith('iptables', ['-I', 'INPUT', '-s', '198.51.100.90/32', '-j', 'DROP']);
  });

  it('does not block at N-1 attempts', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT is_whitelisted')) return [];
      if (sql.includes('FROM firewall_config')) return [{ enforcement_mode: 'iptables', threshold: 2, time_window_seconds: 60, block_duration_seconds: 3600, trunk_ceilings: {} }];
      return [];
    });

    await service.processLogEvent({ ip: '198.51.100.91', username: null, timestamp: '2026-04-27T10:00:00.000Z', kind: 'auth_failure', reason: 'auth failure', detail: 'one' });

    expect(gateway.emitBlocked).not.toHaveBeenCalled();
  });

  it('never blocks whitelisted IPs regardless of attempt count', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT is_whitelisted')) return [{ is_whitelisted: true }];
      if (sql.includes('INSERT INTO firewall_events')) {
        return [{ id: 1, ip: '198.51.100.92', country_code: 'unknown', country_name: 'Unknown', event_type: 'whitelisted', reason: 'whitelisted address', detail: 'attempt', created_at: '2026-04-27T10:00:00.000Z' }];
      }
      return [];
    });

    await service.processLogEvent({ ip: '198.51.100.92', username: null, timestamp: '2026-04-27T10:00:00.000Z', kind: 'auth_failure', reason: 'auth failure', detail: 'attempt' });

    expect(gateway.emitBlocked).not.toHaveBeenCalled();
    expect((service as unknown as { runCommand: jest.Mock }).runCommand).not.toHaveBeenCalled();
  });

  it('generates the expected iptables DROP rule', () => {
    expect(service.buildIptablesDropArgs('203.0.113.9')).toEqual(['-I', 'INPUT', '-s', '203.0.113.9/32', '-j', 'DROP']);
  });

  it('silently drops protected source ranges before any blocking logic', async () => {
    const protectedIps = ['127.0.0.1', '10.20.115.95', '172.17.0.1', '192.168.1.1', '10.8.0.1', '::1'];

    for (const ip of protectedIps) {
      await service.processLogEvent({
        ip,
        username: null,
        timestamp: '2026-04-27T10:00:00.000Z',
        kind: 'auth_failure',
        reason: 'auth failure',
        detail: 'attempt',
      });
    }

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(gateway.emitBlocked).not.toHaveBeenCalled();
    expect(gateway.emitFeed).not.toHaveBeenCalled();
    expect((service as unknown as { runCommand: jest.Mock }).runCommand).not.toHaveBeenCalled();
  });

  it('loads and updates the single firewall config row', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM firewall_config')) {
        return [{ enforcement_mode: 'fail2ban', threshold: 7, time_window_seconds: 600, block_duration_seconds: null, trunk_ceilings: { '1': 20 } }];
      }
      return [];
    });

    const config = await service.getConfig();
    await service.updateConfig({ threshold: 8 });

    expect(config).toMatchObject({ enforcementMode: 'fail2ban', threshold: 7, timeWindowSeconds: 600, blockDurationSeconds: null, trunkCeilings: { '1': 20 } });
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE firewall_config'), expect.arrayContaining([expect.any(String), 8]));
  });
});
