import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import * as net from 'node:net';
import { DataSource, Repository } from 'typeorm';
import { AsteriskConfigService, type AmiQualifyResult } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { DiagnosticsGateway } from './diagnostics.gateway';
import type {
  AmiRegistrationDetail,
  CallEvent,
  DiagnosticsSystemHealth,
  SipTrafficEvent,
  SipMessage,
  TrunkDiagnosticsResult,
} from './diagnostics.types';

const REDIS_SIP_TRAFFIC_CHANNEL = 'callytics:sip-traffic';
const REDIS_CALL_EVENTS_CHANNEL = 'callytics:call-events';

type TrunkDiagnosticsStatus = TrunkDiagnosticsResult['status'];

@Injectable()
export class DiagnosticsService implements OnModuleInit {
  private readonly logger = new Logger(DiagnosticsService.name);
  private readonly ariUrl = process.env.ARI_URL || 'http://127.0.0.1:8088';
  private readonly ariUser = process.env.ARI_USER || 'callytics';
  private readonly ariPass = process.env.ARI_PASS || 'callytics';
  private readonly amiHost = process.env.AMI_HOST || '127.0.0.1';
  private readonly amiPort = Number(process.env.AMI_PORT || 5038);
  private readonly amiUser = process.env.AMI_USER || 'callytics';
  private readonly amiPass = process.env.AMI_PASSWORD || process.env.AMI_PASS || 'callytics';
  private gateway: DiagnosticsGateway | null = null;
  private redisSubscriber: RedisClientType | null = null;
  private readonly trunkResults = new Map<number, TrunkDiagnosticsResult>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SipTrunkEntity)
    private readonly trunksRepository: Repository<SipTrunkEntity>,
    private readonly asteriskConfigService: AsteriskConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.initializeSipTrafficRelay();
  }

  setGateway(gateway: DiagnosticsGateway): void {
    this.gateway = gateway;
  }

  async getSystemHealth(): Promise<DiagnosticsSystemHealth> {
    const checkedAt = new Date().toISOString();
    const [ariInfo, channels, ami, postgres, redis] = await Promise.all([
      this.fetchAriInfo(),
      this.fetchAriChannels(),
      this.asteriskConfigService.checkAmiConnection(),
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    const uptimeSeconds = this.extractUptimeSeconds(ariInfo.data);
    const version = this.extractVersion(ariInfo.data);
    const activeChannels = Array.isArray(channels.data) ? channels.data.length : 0;

    return {
      ari: {
        connected: ariInfo.connected,
        latencyMs: ariInfo.latencyMs,
      },
      ami,
      asterisk: {
        version,
        uptimeSeconds,
      },
      activeChannels,
      postgres,
      redis,
      checkedAt,
      items: [
        {
          label: 'ARI',
          state: ariInfo.connected ? 'healthy' : 'down',
          detail: ariInfo.connected
            ? `${ariInfo.latencyMs ?? 0} ms`
            : 'Disconnected',
        },
        {
          label: 'AMI',
          state: ami.connected ? 'healthy' : 'down',
          detail: ami.connected ? 'Connected' : 'Disconnected',
        },
        {
          label: 'Asterisk',
          state: ariInfo.connected ? 'healthy' : 'degraded',
          detail: [version, uptimeSeconds !== null ? `${uptimeSeconds}s` : null].filter(Boolean).join(' · ') || 'Unknown',
        },
        {
          label: 'Channels',
          state: ariInfo.connected ? 'healthy' : 'degraded',
          detail: String(activeChannels),
        },
        {
          label: 'PostgreSQL',
          state: postgres.reachable ? 'healthy' : 'down',
          detail: postgres.reachable ? 'Reachable' : 'Unreachable',
        },
        {
          label: 'Redis',
          state: redis.reachable ? 'healthy' : 'down',
          detail: redis.reachable ? 'Reachable' : 'Unreachable',
        },
      ],
    };
  }

  async testTrunk(id: number): Promise<TrunkDiagnosticsResult> {
    const trunk = await this.trunksRepository.findOne({ where: { id } });
    if (!trunk) {
      throw new NotFoundException(`Trunk ${id} not found`);
    }

    const result = await this.runTrunkDiagnostics(trunk);
    this.trunkResults.set(trunk.id, result);
    return result;
  }

  async testAllTrunks(): Promise<{ data: TrunkDiagnosticsResult[] }> {
    const trunks = await this.trunksRepository.find({
      where: { enabled: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const results: TrunkDiagnosticsResult[] = [];
    for (let index = 0; index < trunks.length; index += 1) {
      const trunk = trunks[index];
      const result = await this.runTrunkDiagnostics(trunk);
      this.trunkResults.set(trunk.id, result);
      results.push(result);

      if (index < trunks.length - 1) {
        await this.delay(500);
      }
    }

    return { data: results };
  }

  async getSipRegistrations(): Promise<{ data: Array<{
    name: string;
    type: 'extension' | 'trunk' | 'unknown';
    status: 'registered' | 'unregistered' | 'unknown';
    contactUri: string | null;
    roundtripMs: number | null;
    lastSeen: string | null;
  }> }> {
    const [endpoints, contacts, knownExtensions, knownTrunks] = await Promise.all([
      this.asteriskConfigService.getPjsipEndpoints(),
      this.getPjsipContacts(),
      this.loadKnownExtensions(),
      this.loadKnownTrunks(),
    ]);

    const contactMap = new Map<string, AmiRegistrationDetail>();
    for (const contact of contacts) {
      contactMap.set(contact.endpoint, contact);
    }

    const data = endpoints
      .map((endpoint) => {
        const detail = contactMap.get(endpoint.endpoint);
        const type: 'extension' | 'trunk' | 'unknown' = knownExtensions.has(endpoint.endpoint)
          ? 'extension'
          : knownTrunks.has(endpoint.endpoint)
            ? 'trunk'
            : 'unknown';
        const contactUri = detail?.contacts[0] || endpoint.contacts[0] || null;
        const status = this.resolveRegistrationStatus(detail?.contactStatus, endpoint.contacts.length > 0 || Boolean(contactUri));
        return {
          name: endpoint.endpoint,
          type,
          status,
          contactUri,
          roundtripMs: this.roundtripToMs(detail?.roundtripUsec),
          lastSeen: detail?.lastQualifiedAt || null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return { data };
  }

  async getRecentFailures(limit = 20, offset = 0): Promise<{ data: Array<{
    callId: string;
    callUuid: string;
    callerNumber: string;
    flowName: string;
    failedNodeType: string | null;
    errorMessage: string | null;
    startedAt: string;
    durationSeconds: number | null;
  }>; total: number }> {
    const safeLimit = Math.min(100, Math.max(1, limit));
    void offset;

    const rows = await this.dataSource.query(
      `
      SELECT
        cl.call_uuid AS "callId",
        cl.call_uuid AS "callUuid",
        cl.caller_number AS "callerNumber",
        cf.name AS "flowName",
        cl.exit_node_key AS "failedNodeType",
        cl.end_reason AS "errorMessage",
        cl.started_at AS "startedAt",
        cl.duration_seconds AS "durationSeconds"
      FROM call_logs cl
      LEFT JOIN call_flows cf ON cf.id = cl.flow_id
      WHERE cl.end_reason IS NOT NULL
        AND cl.end_reason NOT IN ('completed', 'answered')
      ORDER BY cl.started_at DESC
      LIMIT $1
      `,
      [safeLimit],
    );

    return {
      total: rows.length,
      data: rows.map((row: Record<string, unknown>) => ({
        callId: String(row.callId),
        callUuid: row.callUuid ? String(row.callUuid) : '',
        callerNumber: row.callerNumber ? String(row.callerNumber) : '',
        flowName: row.flowName ? String(row.flowName) : '',
        failedNodeType: row.failedNodeType ? String(row.failedNodeType) : null,
        errorMessage: row.errorMessage ? String(row.errorMessage) : null,
        startedAt: new Date(String(row.startedAt)).toISOString(),
        durationSeconds: row.durationSeconds === null ? null : Number(row.durationSeconds),
      })),
    };
  }

  async getSipMessages(
    page = 1,
    limit = 50,
    callId?: string,
  ): Promise<{ data: SipMessage[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
    const offset = (safePage - 1) * safeLimit;

    if (callId && callId.trim()) {
      const normalizedCallId = callId.trim();
      const [totalRows, rows] = await Promise.all([
        this.dataSource.query('SELECT COUNT(*)::int AS total FROM sip_messages WHERE call_id = $1', [normalizedCallId]),
        this.dataSource.query(
          `
          SELECT
            id,
            call_id AS "callId",
            timestamp,
            method,
            from_uri AS "fromUri",
            to_uri AS "toUri",
            direction,
            response_code AS "responseCode",
            raw_message AS "rawMessage",
            created_at AS "createdAt"
          FROM sip_messages
          WHERE call_id = $1
          ORDER BY timestamp DESC
          LIMIT $2 OFFSET $3
          `,
          [normalizedCallId, safeLimit, offset],
        ),
      ]);

      return {
        data: rows.map((row: Record<string, unknown>) => this.mapSipMessage(row)),
        total: Number(totalRows[0]?.total || 0),
        page: safePage,
        limit: safeLimit,
      };
    }

    const [totalRows, rows] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*)::int AS total FROM sip_messages'),
      this.dataSource.query(
        `
        SELECT
          id,
          call_id AS "callId",
          timestamp,
          method,
          from_uri AS "fromUri",
          to_uri AS "toUri",
          direction,
          response_code AS "responseCode",
          raw_message AS "rawMessage",
          created_at AS "createdAt"
        FROM sip_messages
        ORDER BY timestamp DESC
        LIMIT $1 OFFSET $2
        `,
        [safeLimit, offset],
      ),
    ]);

    return {
      data: rows.map((row: Record<string, unknown>) => this.mapSipMessage(row)),
      total: Number(totalRows[0]?.total || 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async getSipMessagesByCallId(callId: string): Promise<SipMessage[]> {
    const normalizedCallId = callId.trim();
    if (!normalizedCallId) {
      return [];
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        id,
        call_id AS "callId",
        timestamp,
        method,
        from_uri AS "fromUri",
        to_uri AS "toUri",
        direction,
        response_code AS "responseCode",
        raw_message AS "rawMessage",
        created_at AS "createdAt"
      FROM sip_messages
      WHERE call_id = $1
      ORDER BY timestamp ASC
      `,
      [normalizedCallId],
    );

    return rows.map((row: Record<string, unknown>) => this.mapSipMessage(row));
  }

  async testTrunkTcp(host: string, port: number, timeoutMs = 4000): Promise<{ reachable: boolean; latencyMs: number | null; message: string }> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (result: { reachable: boolean; latencyMs: number | null; message: string }) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.connect(port, host, () => {
        finish({
          reachable: true,
          latencyMs: Date.now() - startedAt,
          message: 'Reachable',
        });
      });

      socket.on('timeout', () => {
        finish({
          reachable: false,
          latencyMs: null,
          message: `Timed out after ${timeoutMs}ms`,
        });
      });

      socket.on('error', (error: NodeJS.ErrnoException) => {
        finish({
          reachable: false,
          latencyMs: null,
          message: error.code || error.message || 'Unreachable',
        });
      });
    });
  }

  async testTrunkSipOptions(id: number): Promise<AmiQualifyResult> {
    return this.asteriskConfigService.qualifyEndpoint(`trunk-${id}`);
  }

  private async initializeSipTrafficRelay(): Promise<void> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      return;
    }

    this.redisSubscriber = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });

    this.redisSubscriber.on('error', (error) => {
      this.logger.error(`Diagnostics Redis subscriber error: ${error instanceof Error ? error.message : String(error)}`);
    });

    await this.redisSubscriber.connect();
    await this.redisSubscriber.subscribe(REDIS_SIP_TRAFFIC_CHANNEL, async (message) => {
      try {
        const payload = JSON.parse(message) as SipTrafficEvent;
        this.gateway?.broadcastSipTraffic(payload);
        void this.dataSource.query(
          `
          INSERT INTO sip_messages (
            call_id,
            timestamp,
            method,
            from_uri,
            to_uri,
            direction,
            response_code,
            raw_message
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            payload.callId,
            payload.timestamp,
            payload.method,
            payload.from,
            payload.to,
            payload.direction,
            payload.responseCode,
            payload.rawMessage,
          ],
        ).catch((error) => {
          this.logger.error(`Failed to persist SIP message: ${error instanceof Error ? error.message : String(error)}`);
        });
      } catch (error) {
        this.logger.warn(`Failed to parse SIP traffic payload: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    await this.redisSubscriber.subscribe(REDIS_CALL_EVENTS_CHANNEL, async (message) => {
      try {
        const payload = JSON.parse(message) as CallEvent;
        this.gateway?.broadcastCallEvent(payload);
      } catch (error) {
        this.logger.warn(`Failed to parse call event payload: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async fetchAriInfo(): Promise<{ connected: boolean; latencyMs: number | null; data: Record<string, unknown> | null }> {
    return this.fetchAri('/asterisk/info');
  }

  private async fetchAriChannels(): Promise<{ connected: boolean; latencyMs: number | null; data: unknown[] | null }> {
    const response = await this.fetchAri('/channels');
    return {
      connected: response.connected,
      latencyMs: response.latencyMs,
      data: Array.isArray(response.data) ? response.data : null,
    };
  }

  private async fetchAri(path: string): Promise<{ connected: boolean; latencyMs: number | null; data: Record<string, unknown> | null }> {
    const startedAt = Date.now();
    try {
      const response = await fetch(this.buildAriUrl(path), {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.ariUser}:${this.ariPass}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        return { connected: false, latencyMs: null, data: null };
      }

      return {
        connected: true,
        latencyMs: Date.now() - startedAt,
        data: await response.json() as Record<string, unknown>,
      };
    } catch {
      return { connected: false, latencyMs: null, data: null };
    }
  }

  private buildAriUrl(path: string): string {
    const trimmedBase = this.ariUrl.replace(/\/+$/, '');
    return `${trimmedBase}/ari${path}`;
  }

  private async checkPostgres(): Promise<{ reachable: boolean }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { reachable: true };
    } catch {
      return { reachable: false };
    }
  }

  private async checkRedis(): Promise<{ reachable: boolean }> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      return { reachable: false };
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
      return { reachable: true };
    } catch {
      return { reachable: false };
    } finally {
      if (client) {
        await client.disconnect().catch(() => undefined);
      }
    }
  }

  private extractVersion(data: Record<string, unknown> | null): string | null {
    if (!data) {
      return null;
    }

    const system = data.system as Record<string, unknown> | undefined;
    const build = data.build as Record<string, unknown> | undefined;
    const version = system?.version || build?.version || build?.os || null;
    return version ? String(version) : null;
  }

  private extractUptimeSeconds(data: Record<string, unknown> | null): number | null {
    if (!data) {
      return null;
    }

    const system = data.system as Record<string, unknown> | undefined;
    const status = data.status as Record<string, unknown> | undefined;
    const rawUptime = system?.uptime_seconds ?? status?.uptime_seconds ?? status?.uptime;
    if (typeof rawUptime === 'number') {
      return Math.max(0, Math.round(rawUptime));
    }
    if (typeof rawUptime === 'string' && rawUptime.trim()) {
      const numeric = Number(rawUptime);
      if (Number.isFinite(numeric)) {
        return Math.max(0, Math.round(numeric));
      }
      const startedAt = Date.parse(rawUptime);
      if (!Number.isNaN(startedAt)) {
        return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      }
    }
    return null;
  }

  private async runTrunkDiagnostics(trunk: SipTrunkEntity): Promise<TrunkDiagnosticsResult> {
    const tcp = await this.testTrunkTcp(trunk.host, trunk.port);
    let sip: AmiQualifyResult = {
      status: 'not_loaded',
      rtt_ms: null,
      message: 'Unknown',
    };

    if (tcp.reachable) {
      sip = await this.testTrunkSipOptions(trunk.id);
    }

    const testedAt = new Date().toISOString();
    const status = this.resolveTrunkStatus(tcp.reachable, sip.status);
    const message = !tcp.reachable
      ? tcp.message
      : sip.status === 'reachable'
        ? sip.message
        : 'TCP reachable but SIP OPTIONS failed';

    return {
      trunkId: trunk.id,
      tcpStatus: tcp.reachable ? 'reachable' : 'unreachable',
      tcpLatencyMs: tcp.latencyMs,
      sipStatus: !tcp.reachable
        ? 'unknown'
        : sip.status === 'reachable'
          ? 'reachable'
          : 'unreachable',
      sipLatencyMs: sip.rtt_ms,
      status,
      message,
      testedAt,
    };
  }

  private resolveTrunkStatus(tcpReachable: boolean, sipStatus: AmiQualifyResult['status']): TrunkDiagnosticsStatus {
    if (!tcpReachable) {
      return 'unreachable';
    }
    if (sipStatus === 'reachable') {
      return 'reachable';
    }
    if (sipStatus === 'unreachable' || sipStatus === 'not_loaded') {
      return 'sip_unreachable';
    }
    return 'unknown';
  }

  private resolveRegistrationStatus(
    contactStatus: string | null | undefined,
    hasContact: boolean,
  ): 'registered' | 'unregistered' | 'unknown' {
    const normalized = String(contactStatus || '').toLowerCase();
    if (normalized.includes('unavail') || normalized.includes('unreach') || normalized.includes('unknown')) {
      return 'unregistered';
    }
    if (normalized.includes('avail') || normalized.includes('reach') || hasContact) {
      return 'registered';
    }
    return hasContact ? 'registered' : 'unknown';
  }

  private roundtripToMs(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric > 1000 ? Math.round((numeric / 1000) * 10) / 10 : Math.round(numeric * 10) / 10;
  }

  private mapSipMessage(row: Record<string, unknown>): SipMessage {
    return {
      id: Number(row.id),
      callId: row.callId === null || row.callId === undefined ? null : String(row.callId),
      timestamp: new Date(String(row.timestamp)).toISOString(),
      method: row.method === null || row.method === undefined ? null : String(row.method),
      fromUri: row.fromUri === null || row.fromUri === undefined ? null : String(row.fromUri),
      toUri: row.toUri === null || row.toUri === undefined ? null : String(row.toUri),
      direction: row.direction === null || row.direction === undefined ? null : String(row.direction),
      responseCode: row.responseCode === null || row.responseCode === undefined ? null : Number(row.responseCode),
      rawMessage: row.rawMessage === null || row.rawMessage === undefined ? null : String(row.rawMessage),
      createdAt: row.createdAt === null || row.createdAt === undefined ? null : new Date(String(row.createdAt)).toISOString(),
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async loadKnownExtensions(): Promise<Set<string>> {
    const rows = await this.dataSource.query('SELECT username FROM sip_extensions');
    return new Set(rows.map((row: Record<string, unknown>) => String(row.username)));
  }

  private async loadKnownTrunks(): Promise<Set<string>> {
    const rows = await this.dataSource.query('SELECT id FROM sip_trunks');
    return new Set(rows.map((row: Record<string, unknown>) => `trunk-${row.id}`));
  }

  private async getPjsipContacts(): Promise<AmiRegistrationDetail[]> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.amiHost, port: this.amiPort });
      const contacts: AmiRegistrationDetail[] = [];
      const actionId = `contacts-${Date.now()}`;
      let buffer = '';
      let loggedIn = false;
      let settled = false;

      const finish = (result: AmiRegistrationDetail[]) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.end();
        resolve(result);
      };

      socket.setTimeout(8000, () => finish([]));
      socket.on('error', () => finish([]));
      socket.on('connect', () => {
        socket.write(`Action: Login\r\nUsername: ${this.amiUser}\r\nSecret: ${this.amiPass}\r\n\r\n`);
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');

        while (buffer.includes('\r\n\r\n')) {
          const parts = buffer.split('\r\n\r\n');
          const raw = parts.shift() || '';
          buffer = parts.join('\r\n\r\n');
          const message = this.parseAmiMessage(raw);

          if (!loggedIn && message.Response === 'Success' && message.Message === 'Authentication accepted') {
            loggedIn = true;
            socket.write(`Action: PJSIPShowContacts\r\nActionID: ${actionId}\r\n\r\n`);
            continue;
          }

          if (message.ActionID !== actionId) {
            continue;
          }

          if (message.Event === 'ContactList') {
            contacts.push({
              endpoint: message.Endpoint || 'unknown',
              aor: message.Endpoint || 'unknown',
              contacts: message.Uri ? [message.Uri] : [],
              contactStatus: message.Status || null,
              roundtripUsec: message.RoundtripUsec || null,
              lastQualifiedAt: this.normalizeRegExpire(message.RegExpire),
            });
            continue;
          }

          if (message.Event === 'ContactListComplete') {
            socket.write('Action: Logoff\r\n\r\n');
            finish(contacts);
            return;
          }
        }
      });
    });
  }

  private parseAmiMessage(raw: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const line of raw.split('\r\n')) {
      const separator = line.indexOf(':');
      if (separator === -1) {
        continue;
      }
      parsed[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return parsed;
  }

  private normalizeRegExpire(value: string | undefined): string | null {
    if (!value) {
      return null;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric * 1000).toISOString();
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }

    return null;
  }
}
