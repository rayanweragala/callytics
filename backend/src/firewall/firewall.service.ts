import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import { join } from 'node:path';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import { FirewallGateway } from './firewall.gateway';
import type {
  FirewallBlockedIp,
  FirewallConfig,
  FirewallConfigUpdate,
  FirewallEnforcementMode,
  FirewallEventItem,
  FirewallEventType,
  FirewallFeedEvent,
  FirewallLogEvent,
  FirewallPreflightStatus,
  FirewallStats,
} from './firewall.types';

const REDIS_FIREWALL_CHANNEL = 'callytics:firewall-events';
const GEOIP_DIR = process.env.GEOIP_DIR || '/app/geoip';
const GEOIP_DB_PATH = join(GEOIP_DIR, 'GeoLite2-Country.mmdb');

interface CountryInfo {
  countryCode: string;
  countryName: string;
}

interface GeoIpReader {
  country: (ip: string) => { country?: { isoCode?: string; names?: { en?: string } } } | null;
}

interface Ipv4Range {
  start: number;
  end: number;
}

const PROTECTED_IPV4_RANGES: Ipv4Range[] = [
  { start: ipv4ToNumber('10.0.0.0'), end: ipv4ToNumber('10.255.255.255') },
  { start: ipv4ToNumber('172.16.0.0'), end: ipv4ToNumber('172.31.255.255') },
  { start: ipv4ToNumber('192.168.0.0'), end: ipv4ToNumber('192.168.255.255') },
  { start: ipv4ToNumber('10.8.0.0'), end: ipv4ToNumber('10.8.0.255') },
];

function ipv4ToNumber(ip: string): number {
  const octets = ip.split('.').map((value) => Number(value));
  return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
}

@Injectable()
export class FirewallService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(FirewallService.name);
  private readonly attempts = new Map<string, FirewallLogEvent[]>();
  private redisPublisher: RedisClientType | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private geoReader: GeoIpReader | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gateway: FirewallGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await runSqlMigrations(this.dataSource);
      await this.initializeRedisPublisher();
      await this.initializeGeoIp();
      this.statsTimer = setInterval(() => {
        void this.emitStats();
      }, 30_000);
    } catch (error) {
      this.logger.warn(`firewall init failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.redisPublisher) {
      await this.redisPublisher.disconnect().catch(() => undefined);
      this.redisPublisher = null;
    }
  }

  async processLogEvent(event: FirewallLogEvent): Promise<void> {
    try {
      const ip = this.normalizeIp(event.ip);
      if (!this.isValidIp(ip) || this.isProtectedAddress(ip)) {
        return;
      }
      const normalizedEvent = ip === event.ip ? event : { ...event, ip };

      const country = await this.lookupCountry(normalizedEvent.ip);
      if (normalizedEvent.kind === 'allowed_registration') {
        await this.recordEvent(normalizedEvent.ip, 'allowed', normalizedEvent.reason, normalizedEvent.detail, country);
        return;
      }

      if (await this.isWhitelisted(normalizedEvent.ip)) {
        await this.recordEvent(normalizedEvent.ip, 'whitelisted', 'whitelisted address', normalizedEvent.detail, country);
        return;
      }

      const config = await this.getConfig();
      const now = Date.parse(normalizedEvent.timestamp);
      const cutoff = Number.isNaN(now) ? Date.now() - (config.timeWindowSeconds * 1000) : now - (config.timeWindowSeconds * 1000);
      const existing = this.attempts.get(normalizedEvent.ip) ?? [];
      const next = [...existing.filter((item) => Date.parse(item.timestamp) >= cutoff), normalizedEvent];
      this.attempts.set(normalizedEvent.ip, next);
      await this.upsertStatsAttempt(country);

      if (next.length >= config.threshold) {
        await this.blockIp(normalizedEvent.ip, normalizedEvent.reason, next.length, config, country);
        this.attempts.set(normalizedEvent.ip, []);
      }
    } catch (error) {
      this.logger.warn(`firewall event processing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  parseSecurityLog(rawLine: string): FirewallLogEvent | null {
    const timestamp = this.extractTimestamp(rawLine);
    const ip = this.extractIp(rawLine);
    if (!ip) {
      return null;
    }

    const usernameMatch = rawLine.match(/(?:username|user|endpoint)\s*['"]?([^'"\s<>@]+)['"]?/i)
      ?? rawLine.match(/Registration from ['"]?([^'"\s<>]+)['"]?/i);
    const username = usernameMatch?.[1] ?? null;

    if (/Registration from .+ failed/i.test(rawLine) || /failed to authenticate/i.test(rawLine)) {
      return { ip, username, timestamp, kind: 'failed_registration', reason: 'failed registration', detail: rawLine };
    }

    if (/authentication failed|wrong password|invalid password|401 Unauthorized|403 Forbidden/i.test(rawLine)) {
      return { ip, username, timestamp, kind: 'auth_failure', reason: 'authentication failure', detail: rawLine };
    }

    if (/Request 'INVITE'.+failed|INVITE flood|too many INVITE|flood/i.test(rawLine)) {
      return { ip, username, timestamp, kind: 'invite_flood', reason: 'invite flood', detail: rawLine };
    }

    if (/Registered SIP|Contact .+ is now Reachable|Endpoint .+ is now Reachable/i.test(rawLine)) {
      return { ip, username, timestamp, kind: 'allowed_registration', reason: 'allowed registration', detail: rawLine };
    }

    return null;
  }

  async getConfig(): Promise<FirewallConfig> {
    try {
      const rows = await this.dataSource.query(
        `SELECT enforcement_mode, threshold, time_window_seconds, block_duration_seconds, trunk_ceilings
         FROM firewall_config WHERE id = 1`,
      ) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};
      return {
        enforcementMode: this.normalizeMode(row.enforcement_mode),
        threshold: Number(row.threshold ?? 5),
        timeWindowSeconds: Number(row.time_window_seconds ?? 300),
        blockDurationSeconds: row.block_duration_seconds === null || row.block_duration_seconds === undefined ? null : Number(row.block_duration_seconds),
        trunkCeilings: this.normalizeCeilings(row.trunk_ceilings),
        fail2banInstalled: await this.isFail2banInstalled(),
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to load firewall config');
    }
  }

  async updateConfig(update: FirewallConfigUpdate): Promise<FirewallConfig> {
    try {
      const current = await this.getConfig();
      const next = {
        enforcementMode: update.enforcementMode ?? current.enforcementMode,
        threshold: update.threshold ?? current.threshold,
        timeWindowSeconds: update.timeWindowSeconds ?? current.timeWindowSeconds,
        blockDurationSeconds: update.blockDurationSeconds === undefined ? current.blockDurationSeconds : update.blockDurationSeconds,
        trunkCeilings: update.trunkCeilings ?? current.trunkCeilings,
      };
      await this.dataSource.query(
        `UPDATE firewall_config
         SET enforcement_mode = $1, threshold = $2, time_window_seconds = $3,
             block_duration_seconds = $4, trunk_ceilings = $5::jsonb, updated_at = NOW()
         WHERE id = 1`,
        [next.enforcementMode, next.threshold, next.timeWindowSeconds, next.blockDurationSeconds, JSON.stringify(next.trunkCeilings)],
      );
      return this.getConfig();
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to update firewall config');
    }
  }

  async getPreflightStatus(): Promise<FirewallPreflightStatus> {
    return { fail2banInstalled: await this.isFail2banInstalled() };
  }

  async listBlockedIps(): Promise<{ data: FirewallBlockedIp[] }> {
    try {
      const rows = await this.dataSource.query(
        `SELECT id, host(ip) AS ip, country_code, country_name, attempt_count, reason, enforcement_mode,
                expires_at, created_at, is_whitelisted
         FROM blocked_ips
         WHERE is_whitelisted = FALSE AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC`,
      ) as Array<Record<string, unknown>>;
      return { data: rows.map((row) => this.mapBlockedIp(row)) };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to list blocked IPs');
    }
  }

  async manualBlock(ip: string, reason: string): Promise<FirewallBlockedIp> {
    try {
      const normalizedIp = this.normalizeIp(ip);
      const config = await this.getConfig();
      const country = await this.lookupCountry(normalizedIp);
      return this.blockIp(normalizedIp, reason, 1, config, country);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to block IP');
    }
  }

  async unblock(ip: string): Promise<void> {
    try {
      const normalizedIp = this.normalizeIp(ip);
      await this.removeEnforcement(normalizedIp, (await this.getConfig()).enforcementMode);
      await this.dataSource.query('DELETE FROM blocked_ips WHERE ip = $1::inet AND is_whitelisted = FALSE', [normalizedIp]);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to unblock IP');
    }
  }

  async addWhitelist(ip: string, reason: string): Promise<FirewallBlockedIp> {
    try {
      const normalizedIp = this.normalizeIp(ip);
      const country = await this.lookupCountry(normalizedIp);
      const rows = await this.dataSource.query(
        `INSERT INTO blocked_ips (ip, country_code, country_name, attempt_count, reason, enforcement_mode, expires_at, is_whitelisted)
         VALUES ($1::inet, $2, $3, 0, $4, 'iptables', NULL, TRUE)
         ON CONFLICT (ip) DO UPDATE SET is_whitelisted = TRUE, reason = EXCLUDED.reason, country_code = EXCLUDED.country_code,
           country_name = EXCLUDED.country_name, expires_at = NULL
         RETURNING id, host(ip) AS ip, country_code, country_name, attempt_count, reason, enforcement_mode, expires_at, created_at, is_whitelisted`,
        [normalizedIp, country.countryCode, country.countryName, reason],
      ) as Array<Record<string, unknown>>;
      await this.recordEvent(normalizedIp, 'whitelisted', reason, 'address added to whitelist', country);
      return this.mapBlockedIp(rows[0]);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to whitelist IP');
    }
  }

  async removeWhitelist(ip: string): Promise<void> {
    try {
      await this.dataSource.query('DELETE FROM blocked_ips WHERE ip = $1::inet AND is_whitelisted = TRUE', [this.normalizeIp(ip)]);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to remove whitelist entry');
    }
  }

  async listEvents(page = 1, limit = 50, eventType?: FirewallEventType): Promise<{ data: FirewallEventItem[]; total: number; page: number; limit: number; totalPages: number }> {
    try {
      const safePage = Math.max(1, Math.floor(page));
      const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
      const offset = (safePage - 1) * safeLimit;
      const where = eventType ? 'WHERE event_type = $3' : '';
      const params: Array<string | number> = [safeLimit, offset];
      if (eventType) {
        params.push(eventType);
      }
      const [rows, countRows] = await Promise.all([
        this.dataSource.query(
          `SELECT id, host(ip) AS ip, country_code, country_name, event_type, reason, detail, created_at
           FROM firewall_events ${where}
           ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          params,
        ) as Promise<Array<Record<string, unknown>>>,
        this.dataSource.query(`SELECT COUNT(*)::int AS total FROM firewall_events ${where}`, eventType ? [eventType] : []) as Promise<Array<Record<string, unknown>>>,
      ]);
      const total = Number(countRows[0]?.total ?? 0);
      return { data: rows.map((row) => this.mapEvent(row)), total, page: safePage, limit: safeLimit, totalPages: Math.max(1, Math.ceil(total / safeLimit)) };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to list firewall events');
    }
  }

  async getStats(): Promise<FirewallStats> {
    try {
      const [blockedRows, attemptsRows, topIpRows, countryRows, hourlyRows, trunkRows, config] = await Promise.all([
        this.dataSource.query(`SELECT COUNT(*)::int AS count FROM blocked_ips WHERE created_at::date = CURRENT_DATE AND is_whitelisted = FALSE`) as Promise<Array<Record<string, unknown>>>,
        this.dataSource.query(`SELECT COUNT(*)::int AS count FROM firewall_events WHERE created_at::date = CURRENT_DATE`) as Promise<Array<Record<string, unknown>>>,
        this.dataSource.query(
          `SELECT host(ip) AS ip, country_code, MAX(attempt_count)::int AS attempt_count
           FROM blocked_ips WHERE is_whitelisted = FALSE
           GROUP BY host(ip), country_code ORDER BY attempt_count DESC LIMIT 10`,
        ) as Promise<Array<Record<string, unknown>>>,
        this.dataSource.query(
          `SELECT country_code, country_name, COUNT(*)::int AS count
           FROM firewall_events WHERE created_at::date = CURRENT_DATE
           GROUP BY country_code, country_name ORDER BY count DESC LIMIT 10`,
        ) as Promise<Array<Record<string, unknown>>>,
        this.dataSource.query(
          `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS count
           FROM firewall_events WHERE created_at::date = CURRENT_DATE
           GROUP BY hour ORDER BY hour ASC`,
        ) as Promise<Array<Record<string, unknown>>>,
        this.dataSource.query(`SELECT id, name FROM sip_trunks WHERE enabled = TRUE ORDER BY name ASC`) as Promise<Array<Record<string, unknown>>>,
        this.getConfig(),
      ]);
      const hourlyMap = new Map<number, number>();
      hourlyRows.forEach((row) => hourlyMap.set(Number(row.hour), Number(row.count)));
      return {
        totalBlockedToday: Number(blockedRows[0]?.count ?? 0),
        totalAttemptsToday: Number(attemptsRows[0]?.count ?? 0),
        topIps: topIpRows.map((row) => ({ ip: String(row.ip), countryCode: String(row.country_code), attemptCount: Number(row.attempt_count) })),
        topCountries: countryRows.map((row) => ({ countryCode: String(row.country_code), countryName: String(row.country_name), count: Number(row.count) })),
        hourly: Array.from({ length: 24 }, (_item, hour) => ({ hour, count: hourlyMap.get(hour) ?? 0 })),
        trunks: trunkRows.map((row) => {
          const id = Number(row.id);
          return { id, name: String(row.name), activeCalls: 0, ceiling: config.trunkCeilings[String(id)] ?? 10 };
        }),
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to load firewall stats');
    }
  }

  buildIptablesDropArgs(ip: string): string[] {
    return ['-I', 'INPUT', '-s', this.toFirewallSourceAddress(ip), '-j', 'DROP'];
  }

  private async blockIp(ip: string, reason: string, attemptCount: number, config: FirewallConfig, country: CountryInfo): Promise<FirewallBlockedIp> {
    const normalizedIp = this.normalizeIp(ip);
    if (this.isProtectedAddress(normalizedIp)) {
      const row = await this.findBlockedIp(normalizedIp);
      if (row) {
        return row;
      }
      throw new BadRequestException('Protected IP cannot be blocked');
    }

    if (await this.isWhitelisted(normalizedIp)) {
      await this.recordEvent(normalizedIp, 'whitelisted', 'whitelisted address', reason, country);
      const row = await this.findBlockedIp(normalizedIp);
      if (row) {
        return row;
      }
      throw new BadRequestException('IP is whitelisted');
    }

    const expiresAtSql = config.blockDurationSeconds === null || config.blockDurationSeconds === 0
      ? 'NULL'
      : `NOW() + ($5::int * INTERVAL '1 second')`;
    const rows = await this.dataSource.query(
      `INSERT INTO blocked_ips (ip, country_code, country_name, attempt_count, reason, enforcement_mode, expires_at, is_whitelisted)
       VALUES ($1::inet, $2, $3, $4, $6, $7, ${expiresAtSql}, FALSE)
       ON CONFLICT (ip) DO UPDATE SET attempt_count = GREATEST(blocked_ips.attempt_count, EXCLUDED.attempt_count),
         reason = EXCLUDED.reason, enforcement_mode = EXCLUDED.enforcement_mode, country_code = EXCLUDED.country_code,
         country_name = EXCLUDED.country_name, expires_at = EXCLUDED.expires_at, is_whitelisted = FALSE
       RETURNING id, host(ip) AS ip, country_code, country_name, attempt_count, reason, enforcement_mode, expires_at, created_at, is_whitelisted`,
      [normalizedIp, country.countryCode, country.countryName, attemptCount, config.blockDurationSeconds ?? 0, reason, config.enforcementMode],
    ) as Array<Record<string, unknown>>;

    await this.applyEnforcement(normalizedIp, config.enforcementMode);
    await this.recordEvent(normalizedIp, 'blocked', reason, `${attemptCount} attempts within ${config.timeWindowSeconds}s`, country);
    const blocked = this.mapBlockedIp(rows[0]);
    this.gateway.emitBlocked(blocked);
    return blocked;
  }

  private async findBlockedIp(ip: string): Promise<FirewallBlockedIp | null> {
    const rows = await this.dataSource.query(
      `SELECT id, host(ip) AS ip, country_code, country_name, attempt_count, reason, enforcement_mode, expires_at, created_at, is_whitelisted
       FROM blocked_ips WHERE ip = $1::inet LIMIT 1`,
      [ip],
    ) as Array<Record<string, unknown>>;
    return rows[0] ? this.mapBlockedIp(rows[0]) : null;
  }

  private async recordEvent(ip: string, eventType: FirewallEventType, reason: string, detail: string, country: CountryInfo): Promise<void> {
    const rows = await this.dataSource.query(
      `INSERT INTO firewall_events (ip, country_code, country_name, event_type, reason, detail)
       VALUES ($1::inet, $2, $3, $4, $5, $6)
       RETURNING id, host(ip) AS ip, country_code, country_name, event_type, reason, detail, created_at`,
      [ip, country.countryCode, country.countryName, eventType, reason, detail.slice(0, 2000)],
    ) as Array<Record<string, unknown>>;
    const event = this.mapEvent(rows[0]);
    const feed: FirewallFeedEvent = {
      ip: event.ip,
      countryCode: event.countryCode,
      countryName: event.countryName,
      eventType: event.eventType,
      reason: event.reason,
      detail: event.detail,
      createdAt: event.createdAt,
    };
    if (eventType === 'allowed') {
      this.gateway.emitAllowed(feed);
    }
    this.gateway.emitFeed(feed);
    await this.publishRedis(feed);
  }

  private async upsertStatsAttempt(country: CountryInfo): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO firewall_stats (date, total_blocked, total_attempts, top_countries)
       VALUES (CURRENT_DATE, 0, 1, $1::jsonb)
       ON CONFLICT (date) DO UPDATE SET total_attempts = firewall_stats.total_attempts + 1`,
      [JSON.stringify([{ countryCode: country.countryCode, countryName: country.countryName, count: 1 }])],
    );
  }

  private async applyEnforcement(ip: string, mode: FirewallEnforcementMode): Promise<void> {
    if (mode === 'fail2ban') {
      await this.runCommand('fail2ban-client', ['set', 'asterisk', 'banip', ip]);
      return;
    }
    await this.runCommand('iptables', this.buildIptablesDropArgs(ip));
  }

  private async removeEnforcement(ip: string, mode: FirewallEnforcementMode): Promise<void> {
    try {
      if (mode === 'fail2ban') {
        await this.runCommand('fail2ban-client', ['set', 'asterisk', 'unbanip', ip]);
        return;
      }
      await this.runCommand('iptables', ['-D', 'INPUT', '-s', this.toFirewallSourceAddress(ip), '-j', 'DROP']);
    } catch (error) {
      this.logger.warn(`firewall unenforce failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 10_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private async isFail2banInstalled(): Promise<boolean> {
    try {
      await this.runCommand('fail2ban-client', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  private async initializeRedisPublisher(): Promise<void> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    this.redisPublisher = createClient({ socket: { host: process.env.REDIS_HOST || '127.0.0.1', port: redisPort } });
    this.redisPublisher.on('error', (error) => {
      this.logger.warn(`firewall redis error: ${error instanceof Error ? error.message : String(error)}`);
    });
    await this.redisPublisher.connect().catch((error) => {
      this.logger.warn(`firewall redis connect failed: ${error instanceof Error ? error.message : String(error)}`);
      this.redisPublisher = null;
    });
  }

  private async publishRedis(event: FirewallFeedEvent): Promise<void> {
    if (!this.redisPublisher?.isOpen) {
      return;
    }
    await this.redisPublisher.publish(REDIS_FIREWALL_CHANNEL, JSON.stringify(event)).catch((error) => {
      this.logger.warn(`firewall redis publish failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async emitStats(): Promise<void> {
    try {
      this.gateway.emitStats(await this.getStats());
    } catch (error) {
      this.logger.warn(`firewall stats emit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async initializeGeoIp(): Promise<void> {
    try {
      if (!fs.existsSync(GEOIP_DB_PATH)) {
        await this.downloadGeoIpDatabase();
      }
      if (!fs.existsSync(GEOIP_DB_PATH)) {
        return;
      }
      const geoipModule = await import('@maxmind/geoip2-node').catch(() => null);
      const readerFactory = geoipModule as { Reader?: { open: (path: string) => Promise<GeoIpReader> } } | null;
      if (readerFactory?.Reader?.open) {
        this.geoReader = await readerFactory.Reader.open(GEOIP_DB_PATH);
      }
    } catch (error) {
      this.logger.warn(`geoip unavailable: ${error instanceof Error ? error.message : String(error)}`);
      this.geoReader = null;
    }
  }

  private async downloadGeoIpDatabase(): Promise<void> {
    const licenseKey = process.env.MAXMIND_LICENSE_KEY || '';
    if (!licenseKey) {
      return;
    }
    await fs.promises.mkdir(GEOIP_DIR, { recursive: true });
    await new Promise<void>((resolve) => {
      const url = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=${encodeURIComponent(licenseKey)}&suffix=tar.gz`;
      https.get(url, (response) => {
        response.resume();
        response.on('end', () => resolve());
      }).on('error', () => resolve());
    });
  }

  private async lookupCountry(ip: string): Promise<CountryInfo> {
    try {
      const result = this.geoReader?.country(ip);
      return {
        countryCode: result?.country?.isoCode || 'unknown',
        countryName: result?.country?.names?.en || 'Unknown',
      };
    } catch {
      return { countryCode: 'unknown', countryName: 'Unknown' };
    }
  }

  private isValidIp(value: string): boolean {
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[a-f0-9:]+$/i.test(value);
  }

  private async isWhitelisted(ip: string): Promise<boolean> {
    const rows = await this.dataSource.query('SELECT is_whitelisted FROM blocked_ips WHERE ip = $1::inet LIMIT 1', [ip]) as Array<Record<string, unknown>>;
    return rows[0]?.is_whitelisted === true;
  }

  private extractTimestamp(rawLine: string): string {
    const match = rawLine.match(/^\[([^\]]+)\]/);
    if (!match) {
      return new Date().toISOString();
    }
    const raw = match[1];
    const noYearMatch = raw.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})$/);
    if (noYearMatch) {
      const parsed = new Date(`${new Date().getFullYear()} ${noYearMatch[1]} ${noYearMatch[2]} ${noYearMatch[3]}`);
      return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    }
    const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  private extractIp(rawLine: string): string | null {
    const failedForMatch = rawLine.match(/failed for\s+'((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?'/i);
    if (failedForMatch?.[1]) {
      return this.normalizeIp(failedForMatch[1]);
    }
    const bracketMatch = rawLine.match(/\b(?:from|host|address|source)\s+(?:UDP:|TCP:)?\[?((?:\d{1,3}\.){3}\d{1,3})\]?(?::\d+)?/i);
    if (bracketMatch?.[1]) {
      return this.normalizeIp(bracketMatch[1]);
    }
    const uriMatch = rawLine.match(/@((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?/);
    if (uriMatch?.[1]) {
      return this.normalizeIp(uriMatch[1]);
    }
    const directMatch = rawLine.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
    return directMatch?.[1] ? this.normalizeIp(directMatch[1]) : null;
  }

  private normalizeIp(ip: string): string {
    return ip.trim().replace(/\/\d{1,3}$/, '');
  }

  private toFirewallSourceAddress(ip: string): string {
    const normalizedIp = this.normalizeIp(ip);
    if (normalizedIp.includes(':')) {
      return normalizedIp;
    }
    return `${normalizedIp}/32`;
  }

  private isProtectedAddress(ip: string): boolean {
    const normalizedIp = this.normalizeIp(ip);
    if (normalizedIp === '127.0.0.1' || normalizedIp === '::1') {
      return true;
    }
    if (!this.isIpv4(normalizedIp)) {
      return false;
    }
    const ipNumber = ipv4ToNumber(normalizedIp);
    return PROTECTED_IPV4_RANGES.some((range) => ipNumber >= range.start && ipNumber <= range.end);
  }

  private isIpv4(ip: string): boolean {
    const octets = ip.split('.');
    if (octets.length !== 4) {
      return false;
    }
    return octets.every((value) => {
      if (!/^\d{1,3}$/.test(value)) {
        return false;
      }
      const octet = Number(value);
      return octet >= 0 && octet <= 255;
    });
  }

  private normalizeMode(value: unknown): FirewallEnforcementMode {
    return value === 'fail2ban' ? 'fail2ban' : 'iptables';
  }

  private normalizeCeilings(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const result: Record<string, number> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, ceiling]) => {
      const numeric = Number(ceiling);
      if (Number.isFinite(numeric) && numeric > 0) {
        result[key] = numeric;
      }
    });
    return result;
  }

  private mapBlockedIp(row: Record<string, unknown>): FirewallBlockedIp {
    return {
      id: Number(row.id),
      ip: String(row.ip),
      countryCode: String(row.country_code),
      countryName: String(row.country_name),
      attemptCount: Number(row.attempt_count),
      reason: String(row.reason),
      enforcementMode: this.normalizeMode(row.enforcement_mode),
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
      isWhitelisted: row.is_whitelisted === true,
    };
  }

  private mapEvent(row: Record<string, unknown>): FirewallEventItem {
    return {
      id: Number(row.id),
      ip: String(row.ip),
      countryCode: String(row.country_code),
      countryName: String(row.country_name),
      eventType: String(row.event_type) as FirewallEventType,
      reason: String(row.reason),
      detail: String(row.detail),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}
