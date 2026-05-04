import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { exec as execCallback } from 'node:child_process';
import * as dgram from 'node:dgram';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';

const execAsync = promisify(execCallback);

type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheckResult {
  id: string;
  label: string;
  status: PreflightStatus;
  message: string;
  detail: string;
}

interface PreflightRunResult {
  id: number;
  ranAt: string;
  summary: PreflightStatus;
  checks: PreflightCheckResult[];
}

interface PreflightHistoryResult {
  data: PreflightRunResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PortExpectation {
  id: string;
  protocol: 'tcp' | 'udp';
  port: number;
}

@Injectable()
export class PreflightService implements OnModuleInit {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
  }

  async run(): Promise<PreflightRunResult> {
    const checks = await this.executeChecks();
    const summary = this.calculateSummary(checks);

    const rows = await this.dataSource.query(
      `
      INSERT INTO preflight_runs (summary, checks)
      VALUES ($1, $2::jsonb)
      RETURNING id, ran_at AS "ranAt", summary, checks
      `,
      [summary, JSON.stringify(checks)],
    );

    return this.mapRunRow(rows[0] as Record<string, unknown>);
  }

  async history(page = 1, limit = 10): Promise<PreflightHistoryResult> {
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10;
    const offset = (safePage - 1) * safeLimit;
    const totalRows = await this.dataSource.query(
      `
      SELECT COUNT(*)::int AS total
      FROM preflight_runs
      `,
    );
    const total = Number(totalRows?.[0]?.total ?? 0);
    const rows = await this.dataSource.query(
      `
      SELECT id, ran_at AS "ranAt", summary, checks
      FROM preflight_runs
      ORDER BY ran_at DESC, id DESC
      LIMIT $1
      OFFSET $2
      `,
      [safeLimit, offset],
    );

    const totalPages = total > 0 ? Math.ceil(total / safeLimit) : 1;
    return {
      data: rows.map((row: Record<string, unknown>) => this.mapRunRow(row)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
    };
  }

  private async executeChecks(): Promise<PreflightCheckResult[]> {
    const externalIpPromise = this.detectExternalIp();

    const checks: Array<{ id: string; label: string; run: () => Promise<Omit<PreflightCheckResult, 'id' | 'label'>> }> = [
      { id: 'asterisk_ari', label: 'Asterisk ARI reachable', run: () => this.checkAsteriskAri() },
      { id: 'asterisk_ami', label: 'Asterisk AMI reachable', run: () => this.checkAsteriskAmi() },
      { id: 'sip_port', label: 'SIP port 5080 listening', run: () => this.checkSipPort() },
      { id: 'rtp_range', label: 'RTP port range bound', run: () => this.checkRtpRange() },
      { id: 'port_conflicts', label: 'Host port conflict check', run: () => this.checkPortConflicts() },
      { id: 'postgres', label: 'PostgreSQL reachable', run: () => this.checkPostgres() },
      { id: 'redis', label: 'Redis reachable', run: () => this.checkRedis() },
      { id: 'external_ip', label: 'External IP detection', run: () => this.checkExternalIp(externalIpPromise) },
      { id: 'nat_detected', label: 'NAT detection', run: () => this.checkNatDetected(externalIpPromise) },
      { id: 'stun', label: 'STUN reachability', run: () => this.checkStunReachability() },
      { id: 'disk_space', label: 'Disk space', run: () => this.checkDiskSpace() },
      { id: 'docker_version', label: 'Docker version', run: () => this.checkDockerVersion() },
      { id: 'sip_alg', label: 'SIP ALG (router setting)', run: () => this.checkSipAlg() },
    ];

    const settled = await Promise.allSettled(
      checks.map(async (check) => {
        try {
          const result = await check.run();
          return {
            id: check.id,
            label: check.label,
            status: result.status,
            message: result.message,
            detail: result.detail || '',
          } satisfies PreflightCheckResult;
        } catch (error) {
          return {
            id: check.id,
            label: check.label,
            status: 'fail',
            message: 'Check failed unexpectedly',
            detail: this.extractErrorMessage(error),
          } satisfies PreflightCheckResult;
        }
      }),
    );

    return settled.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        id: checks[index].id,
        label: checks[index].label,
        status: 'fail',
        message: 'Check failed unexpectedly',
        detail: this.extractErrorMessage(result.reason),
      };
    });
  }

  private async detectExternalIp(): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }

      const json = await response.json() as { ip?: unknown };
      if (typeof json.ip === 'string' && net.isIP(json.ip)) {
        return json.ip;
      }

      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async checkAsteriskAri(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const ariUrl = (process.env.ARI_URL ?? 'http://127.0.0.1:8088').replace(/\/+$/, '');
    const ariPassword = process.env.ARI_PASSWORD ?? 'callytics_ari_pass';

    try {
      const response = await fetch(`${ariUrl}/ari/asterisk/info`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`callytics:${ariPassword}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        return {
          status: 'fail',
          message: 'Asterisk ARI is not reachable. Asterisk may not have started.',
          detail: `HTTP ${response.status}`,
        };
      }

      const payload = await response.json() as { system?: { version?: unknown } };
      const version = typeof payload.system?.version === 'string' ? payload.system.version : 'unknown';
      const majorVersion = Number.parseInt(version.split('.')[0], 10);
      const meetsRequirement = Number.isFinite(majorVersion) && majorVersion >= 20;

      if (!meetsRequirement) {
        return {
          status: 'warn',
          message: `Asterisk ${version} detected. Version 20+ is required. The apt package installs broken v18 — Asterisk must be built from source.`,
          detail: '',
        };
      }

      return {
        status: 'pass',
        message: `Asterisk ${version} is running`,
        detail: '',
      };
    } catch (error) {
      return {
        status: 'fail',
        message: 'Asterisk ARI is not reachable. Asterisk may not have started.',
        detail: this.extractErrorMessage(error),
      };
    }
  }

  private async checkAsteriskAmi(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const finish = (result: Omit<PreflightCheckResult, 'id' | 'label'>) => {
        if (resolved) {
          return;
        }
        resolved = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(3000);

      const amiHost = process.env.AMI_HOST ?? '127.0.0.1';
      const amiPort = Number(process.env.AMI_PORT ?? 5038);
      socket.connect(amiPort, amiHost, () => {
        socket.write('Action: Ping\r\n\r\n');
      });

      socket.on('data', (_chunk: Buffer) => {
        finish({
          status: 'pass',
          message: 'AMI is reachable',
          detail: '',
        });
      });

      socket.on('timeout', () => {
        finish({
          status: 'fail',
          message: 'Asterisk AMI is not responding on port 5038',
          detail: 'timeout after 3s',
        });
      });

      socket.on('error', (error: NodeJS.ErrnoException) => {
        finish({
          status: 'fail',
          message: 'Asterisk AMI is not responding on port 5038',
          detail: error.code || error.message,
        });
      });

      socket.on('close', () => {
        if (!resolved) {
          finish({
            status: 'fail',
            message: 'Asterisk AMI is not responding on port 5038',
            detail: 'connection closed without success response',
          });
        }
      });
    });
  }

  private async checkSipPort(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const output = await this.execCommand('ss -ulnp');
    if (output.includes(':5080')) {
      return {
        status: 'pass',
        message: 'SIP is listening on port 5080',
        detail: '',
      };
    }

    return {
      status: 'warn',
      message: 'SIP port 5080 does not appear to be listening. Asterisk may not have started correctly.',
      detail: '',
    };
  }

  private async checkRtpRange(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const output = await this.execCommand('ss -ulnp');
    const ports = this.extractPorts(output, 'udp');
    const hasRtpPort = ports.some((port) => port >= 10000 && port <= 20000);

    if (hasRtpPort) {
      return {
        status: 'pass',
        message: 'RTP ports are active in range 10000–20000',
        detail: '',
      };
    }

    const ariReachable = await this.isAriReachable();
    if (ariReachable) {
      return {
        status: 'pass',
        message: 'RTP range 10000–20000 is configured. Ports will be bound dynamically when calls are active.',
        detail: '',
      };
    }

    return {
      status: 'warn',
      message: 'No RTP ports detected. Audio may not work. Check rtp.conf and ensure Asterisk is running.',
      detail: '',
    };
  }

  private async checkPortConflicts(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const [tcpOutput, udpOutput] = await Promise.all([
      this.execCommand('ss -tlnp'),
      this.execCommand('ss -ulnp'),
    ]);

    const expectations: PortExpectation[] = [
      { id: 'Asterisk ARI', protocol: 'tcp', port: 8088 },
      { id: 'Asterisk AMI', protocol: 'tcp', port: 5038 },
      { id: 'Asterisk SIP', protocol: 'udp', port: 5080 },
      { id: 'Backend API', protocol: 'tcp', port: 3001 },
      { id: 'Redis', protocol: 'tcp', port: 6380 },
      { id: 'PostgreSQL', protocol: 'tcp', port: 5432 },
    ];

    const warnings: string[] = [];

    for (const expectation of expectations) {
      const output = expectation.protocol === 'tcp' ? tcpOutput : udpOutput;
      const line = output
        .split(/\r?\n/)
        .find((entry) => this.lineHasPort(entry, expectation.port));

      if (!line) {
        warnings.push(`Port ${expectation.port} (${expectation.id}) is not bound. The service may be down.`);
      }
    }

    if (warnings.length > 0) {
      return {
        status: 'warn',
        message: warnings.join(' '),
        detail: '',
      };
    }

    return {
      status: 'pass',
      message: 'All expected service ports are bound (8088, 5038, 5080, 3001, 6380, 5432)',
      detail: '',
    };
  }

  private async checkPostgres(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        status: 'pass',
        message: 'PostgreSQL is reachable',
        detail: '',
      };
    } catch {
      return {
        status: 'fail',
        message: 'PostgreSQL is not reachable — check database container',
        detail: '',
      };
    }
  }

  private async checkRedis(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      return {
        status: 'fail',
        message: 'Redis is not reachable — check Redis container',
        detail: 'invalid REDIS_PORT',
      };
    }

    let client: RedisClientType | null = null;
    try {
      client = createClient({
        socket: {
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: redisPort,
        },
      });
      await client.connect();
      await client.ping();
      return {
        status: 'pass',
        message: 'Redis is reachable',
        detail: '',
      };
    } catch {
      return {
        status: 'fail',
        message: 'Redis is not reachable — check Redis container',
        detail: '',
      };
    } finally {
      if (client) {
        await client.disconnect().catch(() => undefined);
      }
    }
  }

  private async checkExternalIp(externalIpPromise: Promise<string | null>): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const externalIp = await externalIpPromise;

    if (externalIp) {
      return {
        status: 'pass',
        message: `External IP: ${externalIp}`,
        detail: '',
      };
    }

    return {
      status: 'warn',
      message: 'Could not detect external IP. Outbound internet access may be blocked.',
      detail: '',
    };
  }

  private async checkNatDetected(externalIpPromise: Promise<string | null>): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const externalIp = await externalIpPromise;

    if (!externalIp) {
      return {
        status: 'warn',
        message: 'Could not determine NAT status — external IP check failed.',
        detail: '',
      };
    }

    const localIps = Object.values(os.networkInterfaces())
      .flat()
      .filter((item): item is os.NetworkInterfaceInfo => Boolean(item))
      .map((item) => item.address);

    if (localIps.includes(externalIp)) {
      return {
        status: 'pass',
        message: `No NAT detected. Server has a direct public IP (${externalIp}).`,
        detail: '',
      };
    }

    return {
      status: 'warn',
      message: `NAT detected. Your server is behind NAT. Ensure your SIP trunk is configured with the correct external IP (${externalIp}), and that RTP ports 10000–20000 are forwarded to this machine.`,
      detail: '',
    };
  }

  private async checkStunReachability(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const transactionId = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)));
      const packet = Buffer.alloc(20);
      packet.writeUInt16BE(0x0001, 0);
      packet.writeUInt16BE(0x0000, 2);
      packet.writeUInt32BE(0x2112a442, 4);
      transactionId.copy(packet, 8);

      const timeout = setTimeout(() => {
        socket.close();
        resolve({
          status: 'warn',
          message: 'STUN server unreachable. Outbound UDP may be blocked.',
          detail: '',
        });
      }, 3000);

      socket.once('message', () => {
        clearTimeout(timeout);
        socket.close();
        resolve({
          status: 'pass',
          message: 'STUN server reachable. Internet UDP connectivity confirmed. Note: this confirms internet access, not external RTP reachability from remote callers.',
          detail: '',
        });
      });

      socket.once('error', (error) => {
        clearTimeout(timeout);
        socket.close();
        resolve({
          status: 'warn',
          message: 'STUN server unreachable. Outbound UDP may be blocked.',
          detail: this.extractErrorMessage(error),
        });
      });

      socket.send(packet, 19302, 'stun.l.google.com');
    });
  }

  private async checkDiskSpace(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    const output = await this.execCommand('df -h /');
    const lines = output.split(/\r?\n/).filter(Boolean);
    const dataLine = lines[1] || '';
    const columns = dataLine.trim().split(/\s+/);
    const avail = columns[3] || 'unknown';
    const usageMatch = dataLine.match(/\s(\d+)%\s/);
    const usage = usageMatch ? Number.parseInt(usageMatch[1], 10) : Number.NaN;

    if (!Number.isFinite(usage)) {
      return {
        status: 'fail',
        message: 'Disk check failed unexpectedly',
        detail: 'Unable to parse df output',
      };
    }

    if (usage > 90) {
      return {
        status: 'fail',
        message: `Disk is ${usage}% used with only ${avail} remaining. Recordings and logs may fail. Free up space immediately.`,
        detail: '',
      };
    }

    if (usage >= 80) {
      return {
        status: 'warn',
        message: `Disk is ${usage}% used with only ${avail} remaining. Recording storage may run out soon.`,
        detail: '',
      };
    }

    return {
      status: 'pass',
      message: `Disk is ${usage}% used — ${avail} available`,
      detail: '',
    };
  }

  private async checkDockerVersion(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    try {
      const detectedVersion = await this.readDockerEngineVersion();
      const versionMatch = detectedVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
      if (!versionMatch || !versionMatch[1]) {
        return {
          status: 'fail',
          message: 'Could not parse Docker version. Upgrade Docker to version 24 or newer.',
          detail: detectedVersion,
        };
      }

      const majorVersion = Number.parseInt(versionMatch[1], 10);
      if (!Number.isFinite(majorVersion) || majorVersion < 24) {
        return {
          status: 'fail',
          message: `Docker ${detectedVersion} detected. Upgrade Docker to version 24 or newer.`,
          detail: detectedVersion,
        };
      }

      return {
        status: 'pass',
        message: `Docker ${detectedVersion} detected`,
        detail: '',
      };
    } catch (error) {
      return {
        status: 'fail',
        message: 'Docker Engine is not reachable on /var/run/docker.sock. Install or upgrade Docker to version 24 or newer.',
        detail: this.extractErrorMessage(error),
      };
    }
  }

  private async readDockerEngineVersion(): Promise<string> {
    const response = await new Promise<{ statusCode?: number; body: Buffer }>((resolve, reject) => {
      const request = http.request(
        {
          socketPath: '/var/run/docker.sock',
          path: '/version',
          method: 'GET',
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) });
          });
          res.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end();
    });

    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`docker socket returned ${response.statusCode ?? 'unknown status'}`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw new Error(`failed to parse docker /version response: ${this.extractErrorMessage(error)}`);
    }

    const version = (payload as { Version?: unknown }).Version;
    if (typeof version !== 'string' || version.trim().length === 0) {
      throw new Error('docker /version response missing Version field');
    }
    return version.trim();
  }

  private async checkSipAlg(): Promise<Omit<PreflightCheckResult, 'id' | 'label'>> {
    return {
      status: 'warn',
      message: 'SIP ALG cannot be detected from inside the server. If you are behind a consumer router (home broadband, office router), disable SIP ALG in your router settings. SIP ALG causes one-way audio, random call failures, and registration instability on almost every major router brand including TP-Link, ASUS, Netgear, and BT HomeHub.',
      detail: 'This warning is always shown. Dismiss it once you have verified your router settings.',
    };
  }

  private calculateSummary(checks: PreflightCheckResult[]): PreflightStatus {
    if (checks.some((check) => check.status === 'fail')) {
      return 'fail';
    }

    if (checks.some((check) => check.status === 'warn')) {
      return 'warn';
    }

    return 'pass';
  }

  private async execCommand(command: string): Promise<string> {
    const { stdout } = await execAsync(command);
    return stdout;
  }

  private async isAriReachable(): Promise<boolean> {
    const ariUrl = (process.env.ARI_URL ?? 'http://127.0.0.1:8088').replace(/\/+$/, '');
    const ariPassword = process.env.ARI_PASSWORD ?? 'callytics_ari_pass';

    try {
      const response = await fetch(`${ariUrl}/ari/asterisk/info`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`callytics:${ariPassword}`).toString('base64')}`,
        },
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  private extractPorts(output: string, _protocol: 'udp' | 'tcp'): number[] {
    const lines = output.split(/\r?\n/).filter(Boolean);
    return lines.flatMap((line) => {
      const matches = line.matchAll(/:(\d+)\s/g);
      return Array.from(matches)
        .map((match) => Number.parseInt(match[1], 10))
        .filter((port) => Number.isFinite(port));
    });
  }

  private lineHasPort(line: string, port: number): boolean {
    return new RegExp(`:${port}(?:\\s|$)`).test(line);
  }

  private mapRunRow(row: Record<string, unknown>): PreflightRunResult {
    const rawChecks = row.checks;
    const parsedChecks = typeof rawChecks === 'string'
      ? JSON.parse(rawChecks) as PreflightCheckResult[]
      : Array.isArray(rawChecks)
        ? rawChecks as PreflightCheckResult[]
        : [];

    return {
      id: Number(row.id),
      ranAt: new Date(String(row.ranAt)).toISOString(),
      summary: String(row.summary) as PreflightStatus,
      checks: parsedChecks.map((check) => ({
        id: check.id,
        label: check.label,
        status: check.status,
        message: check.message,
        detail: check.detail || '',
      })),
    };
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
