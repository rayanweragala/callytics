import { PreflightService } from './preflight.service';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));

describe('PreflightService', () => {
  let service: PreflightService;
  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(() => {
    service = new PreflightService(mockDataSource as any);
    mockDataSource.query.mockReset();
    jest.restoreAllMocks();
  });

  it('each check result has id, label, status, message, detail', async () => {
    const pass = { status: 'pass', message: 'ok', detail: '' };

    jest.spyOn(service as any, 'checkAsteriskAri').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkAsteriskAmi').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkSipPort').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkRtpRange').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkPortConflicts').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkPostgres').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkRedis').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkExternalIp').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkNatDetected').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkStunReachability').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkDiskSpace').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkSipAlg').mockResolvedValue(pass);

    const checks = await (service as any).executeChecks();

    expect(checks).toHaveLength(12);
    for (const check of checks) {
      expect(check).toEqual(expect.objectContaining({
        id: expect.any(String),
        label: expect.any(String),
        status: expect.stringMatching(/pass|warn|fail/),
        message: expect.any(String),
        detail: expect.any(String),
      }));
    }
  });

  it('asterisk_ari returns warn with version message when ARI responds with version 18.x', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ system: { version: '18.22.1' } }),
    } as Response);

    const result = await (service as any).checkAsteriskAri();

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Asterisk 18.22.1 detected. Version 20+ is required.');
  });

  it("sip_alg always returns status 'warn' regardless of environment", async () => {
    const originalAriUrl = process.env.ARI_URL;
    const originalAriPassword = process.env.ARI_PASSWORD;
    process.env.ARI_URL = 'http://example.com:9999';
    process.env.ARI_PASSWORD = 'different-password';

    try {
      const result = await (service as any).checkSipAlg();

      expect(result.status).toBe('warn');
      expect(result.message).toContain('SIP ALG cannot be detected from inside the server');
      expect(result.detail).toContain('always shown');
    } finally {
      if (originalAriUrl === undefined) {
        delete process.env.ARI_URL;
      } else {
        process.env.ARI_URL = originalAriUrl;
      }
      if (originalAriPassword === undefined) {
        delete process.env.ARI_PASSWORD;
      } else {
        process.env.ARI_PASSWORD = originalAriPassword;
      }
    }
  });

  it('disk_space returns pass at 60, warn at 85, and fail at 92', async () => {
    const execSpy = jest.spyOn(service as any, 'execCommand');
    execSpy
      .mockResolvedValueOnce('Filesystem Size Used Avail Use% Mounted on\n/dev/root 100G 60G 40G 60% /\n')
      .mockResolvedValueOnce('Filesystem Size Used Avail Use% Mounted on\n/dev/root 100G 85G 15G 85% /\n')
      .mockResolvedValueOnce('Filesystem Size Used Avail Use% Mounted on\n/dev/root 100G 92G 8G 92% /\n');

    const passResult = await (service as any).checkDiskSpace();
    const warnResult = await (service as any).checkDiskSpace();
    const failResult = await (service as any).checkDiskSpace();

    expect(passResult.status).toBe('pass');
    expect(passResult.message).toContain('Disk is 60% used — 40G available');

    expect(warnResult.status).toBe('warn');
    expect(warnResult.message).toContain('Disk is 85% used with only 15G remaining');

    expect(failResult.status).toBe('fail');
    expect(failResult.message).toContain('Disk is 92% used with only 8G remaining');
  });

  it('rtp_range returns pass with dynamic configured message when no RTP ports are found but ARI is reachable', async () => {
    jest.spyOn(service as any, 'execCommand').mockResolvedValue('State Recv-Q Send-Q Local Address:Port Peer Address:Port\nUNCONN 0 0 0.0.0.0:5080 0.0.0.0:*\n');
    jest.spyOn(service as any, 'isAriReachable').mockResolvedValue(true);

    const result = await (service as any).checkRtpRange();

    expect(result.status).toBe('pass');
    expect(result.message).toBe('RTP range 10000–20000 is configured. Ports will be bound dynamically when calls are active.');
  });

  it('port_conflicts returns pass when all expected ports are bound', async () => {
    jest.spyOn(service as any, 'execCommand')
      .mockResolvedValueOnce('LISTEN 0 4096 0.0.0.0:8088 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:5038 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:3001 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:6380 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:5432 0.0.0.0:*\n')
      .mockResolvedValueOnce('UNCONN 0 0 0.0.0.0:5080 0.0.0.0:*\n');

    const result = await (service as any).checkPortConflicts();

    expect(result.status).toBe('pass');
    expect(result.message).toBe('All expected service ports are bound (8088, 5038, 5080, 3001, 6380, 5432)');
  });

  it('port_conflicts returns warn listing the missing port name when one expected port is absent', async () => {
    jest.spyOn(service as any, 'execCommand')
      .mockResolvedValueOnce('LISTEN 0 4096 0.0.0.0:8088 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:5038 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:3001 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:5432 0.0.0.0:*\n')
      .mockResolvedValueOnce('UNCONN 0 0 0.0.0.0:5080 0.0.0.0:*\n');

    const result = await (service as any).checkPortConflicts();

    expect(result.status).toBe('warn');
    expect(result.message).toContain('Port 6380 (Redis) is not bound. The service may be down.');
  });

  it('summary logic is fail > warn > pass', () => {
    const passOnly = (service as any).calculateSummary([{ status: 'pass' }]);
    const warn = (service as any).calculateSummary([{ status: 'pass' }, { status: 'warn' }]);
    const fail = (service as any).calculateSummary([{ status: 'warn' }, { status: 'fail' }]);

    expect(passOnly).toBe('pass');
    expect(warn).toBe('warn');
    expect(fail).toBe('fail');
  });

  it('unexpected throw in a check is returned as fail with detail', async () => {
    const pass = { status: 'pass', message: 'ok', detail: '' };

    jest.spyOn(service as any, 'checkAsteriskAri').mockRejectedValue(new Error('boom'));
    jest.spyOn(service as any, 'checkAsteriskAmi').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkSipPort').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkRtpRange').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkPortConflicts').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkPostgres').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkRedis').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkExternalIp').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkNatDetected').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkStunReachability').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkDiskSpace').mockResolvedValue(pass);
    jest.spyOn(service as any, 'checkSipAlg').mockResolvedValue(pass);

    const checks = await (service as any).executeChecks();
    const ariCheck = checks.find((check: any) => check.id === 'asterisk_ari');

    expect(ariCheck.status).toBe('fail');
    expect(ariCheck.message).toBe('Check failed unexpectedly');
    expect(ariCheck.detail).toContain('boom');
  });
});
