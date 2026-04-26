import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import * as net from 'node:net';
import { DataSource, Repository } from 'typeorm';
import { AsteriskConfigService, type AmiQualifyResult } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { DiagnosticsGateway } from './diagnostics.gateway';
import type {
  AmiRegistrationDetail,
  AmiInboundRegistrationDetail,
  CallEvent,
  CallTimelineEvent,
  DiagnosticsSystemHealth,
  SipTrafficEvent,
  SipMessage,
  RegistrationHealthResponse,
  TrunkDiagnosticsResult,
} from './diagnostics.types';

const REDIS_SIP_TRAFFIC_CHANNEL = 'callytics:sip-traffic';
const REDIS_CALL_EVENTS_CHANNEL = 'callytics:call-events';
const REDIS_CALL_TIMELINE_CHANNEL = 'callytics:call-timeline';

type TrunkDiagnosticsStatus = TrunkDiagnosticsResult['status'];

interface SipCodeInfo {
  title: string;
  explanation: string;
}

interface RawSipOptionsResult {
  sent: string;
  response: string;
  rawCaptureAvailable: boolean;
  codecsSupported: string[];
}

const SIP_CODE_INFO: Record<number, SipCodeInfo> = {
  100: { title: 'Processing', explanation: 'Request received, searching for destination. Not an error.' },
  200: { title: 'Success', explanation: 'Request accepted. For INVITE this means call connected.' },
  202: { title: 'Accepted', explanation: 'Request accepted for processing, not yet completed.' },
  301: { title: 'Moved Permanently', explanation: 'Endpoint has a new permanent address. Update your config.' },
  302: { title: 'Moved Temporarily', explanation: 'Endpoint temporarily at a different address.' },
  400: { title: 'Bad Request', explanation: 'Malformed SIP message. Check headers and syntax.' },
  401: { title: 'Authentication Challenge', explanation: 'Normal if followed by retry with credentials. Problem if repeated without resolution.' },
  403: { title: 'Forbidden', explanation: 'Credentials rejected or IP not authorized. Check username, password, and IP whitelist.' },
  404: { title: 'Not Found', explanation: 'Destination extension or URI does not exist on this server.' },
  407: { title: 'Proxy Auth Required', explanation: 'Proxy is demanding credentials. Check trunk authentication config.' },
  408: { title: 'Request Timeout', explanation: 'No response from destination. Check network connectivity and firewall rules.' },
  480: { title: 'Temporarily Unavailable', explanation: 'Endpoint exists but is not currently reachable. May be offline or busy.' },
  481: { title: 'Call Leg Does Not Exist', explanation: 'Transaction or dialog not found. Often a timing issue on BYE or CANCEL.' },
  486: { title: 'Busy Here', explanation: 'Endpoint is busy. Expected on busy extensions.' },
  487: { title: 'Request Terminated', explanation: 'Call was cancelled before answer. Normal on user-initiated cancel.' },
  488: { title: 'Not Acceptable Here', explanation: 'Codec or media mismatch. Check SDP offer and accepted codecs on both sides.' },
  500: { title: 'Server Internal Error', explanation: 'Asterisk encountered an unexpected error. Check Asterisk logs.' },
  503: { title: 'Service Unavailable', explanation: 'Server overloaded or temporarily down.' },
  504: { title: 'Server Timeout', explanation: 'Upstream server did not respond in time.' },
  600: { title: 'Busy Everywhere', explanation: 'All endpoints for this destination are busy.' },
  603: { title: 'Decline', explanation: 'Destination explicitly rejected the call. Check inbound route configuration.' },
};

@Injectable()
export class DiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(DiagnosticsService.name);
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

  async onModuleDestroy(): Promise<void> {
    if (!this.redisSubscriber) {
      return;
    }

    await this.redisSubscriber.disconnect().catch(() => undefined);
    this.redisSubscriber = null;
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

  async getSipRegistrations(): Promise<RegistrationHealthResponse> {
    const [endpoints, contacts, inboundRegistrations, knownExtensions, knownTrunks] = await Promise.all([
      this.asteriskConfigService.getPjsipEndpoints(),
      this.getPjsipContacts(),
      this.getPjsipInboundRegistrationStatuses(),
      this.loadKnownExtensions(),
      this.loadKnownTrunks(),
    ]);

    const contactMap = new Map<string, AmiRegistrationDetail>();
    for (const contact of contacts) {
      contactMap.set(contact.endpoint, contact);
    }

    const extensions = endpoints
      .filter((endpoint) => knownExtensions.has(endpoint.endpoint))
      .map((endpoint) => {
        const detail = contactMap.get(endpoint.endpoint);
        const contactUri = detail?.contacts[0] || endpoint.contacts[0] || null;
        const status = this.resolveRegistrationStatus(detail?.contactStatus, endpoint.contacts.length > 0 || Boolean(contactUri));
        return {
          extension: endpoint.endpoint,
          displayName: knownExtensions.get(endpoint.endpoint) || endpoint.endpoint,
          status: status === 'registered' ? 'registered' as const : 'unregistered' as const,
          registeredIp: status === 'registered' ? this.extractIpFromUri(contactUri) : null,
          lastSeen: detail?.lastSeen || null,
          expiresIn: this.secondsUntil(detail?.expiresAt || null),
        };
      })
      .sort((left, right) => left.extension.localeCompare(right.extension));

    const trunkMap = new Map<string, AmiInboundRegistrationDetail>();
    for (const registration of inboundRegistrations) {
      trunkMap.set(registration.trunkName, registration);
    }

    const trunks = Array.from(knownTrunks.entries())
      .map(([endpoint, trunk]) => {
        const registration = trunkMap.get(endpoint) ?? trunkMap.get(trunk.name);
        return {
          trunkName: trunk.name,
          host: trunk.host,
          status: registration?.status ?? 'unknown' as const,
          lastRegistration: registration?.lastRegistration ?? null,
          expiresIn: this.secondsUntil(registration?.expiresAt ?? null),
        };
      })
      .sort((left, right) => left.trunkName.localeCompare(right.trunkName));

    return { extensions, trunks };
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
        AppLogger.redisConsume(REDIS_SIP_TRAFFIC_CHANNEL, {
          callId: payload.callId,
          method: payload.method,
          direction: payload.direction,
        });
        this.gateway?.broadcastSipTraffic(payload);
        const startedAt = Date.now();
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
        ).then(() => {
          AppLogger.dbQuery('insert', 'sip_messages', startedAt);
        }).catch((error) => {
          this.logger.error('Failed to persist SIP message', error instanceof Error ? error.stack : String(error));
        });
      } catch (error) {
        this.logger.error('Failed to parse SIP traffic payload', error instanceof Error ? error.stack : String(error));
      }
    });
    await this.redisSubscriber.subscribe(REDIS_CALL_EVENTS_CHANNEL, async (message) => {
      try {
        const payload = JSON.parse(message) as CallEvent;
        AppLogger.redisConsume(REDIS_CALL_EVENTS_CHANNEL, {
          callId: payload.callId,
          type: payload.type,
        });
        this.gateway?.broadcastCallEvent(payload);
      } catch (error) {
        this.logger.error('Failed to parse call event payload', error instanceof Error ? error.stack : String(error));
      }
    });

    await this.redisSubscriber.subscribe(REDIS_CALL_TIMELINE_CHANNEL, async (message) => {
      try {
        const payload = JSON.parse(message) as CallTimelineEvent;
        if (!payload || typeof payload.callId !== 'string' || !payload.callId || typeof payload.nodeType !== 'string' || !payload.nodeType) {
          return;
        }
        AppLogger.redisConsume(REDIS_CALL_TIMELINE_CHANNEL, {
          callId: payload.callId,
          nodeType: payload.nodeType,
          nodeId: payload.nodeId,
        });
        this.gateway?.broadcastCallTimelineEvent(payload);
      } catch (error) {
        this.logger.error('Failed to parse call timeline payload', error instanceof Error ? error.stack : String(error));
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
    let rawOptions: RawSipOptionsResult = {
      sent: '',
      response: '',
      rawCaptureAvailable: false,
      codecsSupported: [],
    };

    if (tcp.reachable) {
      sip = await this.testTrunkSipOptions(trunk.id);
      rawOptions = await this.findRawSipOptionsCapture(trunk, new Date());
    }

    const testedAt = new Date().toISOString();
    const status = this.resolveTrunkStatus(tcp.reachable, sip.status);
    const sipCode = this.resolveSipCode(sip);
    const codeInfo = this.getSipCodeInfo(sipCode);
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
      sipCode,
      sipCodeTitle: codeInfo.title,
      sipCodeExplanation: codeInfo.explanation,
      rawOptionsSent: rawOptions.sent,
      rawOptionsResponse: rawOptions.response,
      rawCaptureAvailable: rawOptions.rawCaptureAvailable,
      codecsSupported: rawOptions.codecsSupported,
    };
  }

  private resolveSipCode(result: AmiQualifyResult): number {
    if (result.status === 'reachable') {
      return 200;
    }
    if (result.status === 'unreachable' || result.status === 'not_loaded') {
      return 503;
    }
    return 503;
  }

  private getSipCodeInfo(code: number): SipCodeInfo {
    return SIP_CODE_INFO[code] ?? {
      title: 'Unknown Response',
      explanation: 'No description available for this code.',
    };
  }

  private async findRawSipOptionsCapture(trunk: SipTrunkEntity, testTime: Date): Promise<RawSipOptionsResult> {
    const windowStart = new Date(testTime.getTime() - 5000).toISOString();
    const windowEnd = new Date(testTime.getTime() + 5000).toISOString();
    const hostNeedle = `%${trunk.host}%`;

    try {
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
        WHERE timestamp BETWEEN $1 AND $2
          AND (
            from_uri ILIKE $3
            OR to_uri ILIKE $3
            OR raw_message ILIKE $3
          )
        ORDER BY timestamp ASC
        `,
        [windowStart, windowEnd, hostNeedle],
      );

      const messages = rows.map((row: Record<string, unknown>) => this.mapSipMessage(row));
      const request = messages.find((message) => this.isOptionsRequestForHost(message, trunk.host));
      const response = messages.find((message) => {
        if (!this.isOptionsResponseForHost(message, trunk.host)) {
          return false;
        }
        if (!request) {
          return true;
        }
        return Date.parse(message.timestamp) >= Date.parse(request.timestamp);
      });

      if (!request || !response) {
        return {
          sent: '',
          response: '',
          rawCaptureAvailable: false,
          codecsSupported: [],
        };
      }

      return {
        sent: request.rawMessage || '',
        response: response.rawMessage || '',
        rawCaptureAvailable: true,
        codecsSupported: this.parseSdpCodecs(response.rawMessage || ''),
      };
    } catch {
      return {
        sent: '',
        response: '',
        rawCaptureAvailable: false,
        codecsSupported: [],
      };
    }
  }

  private isOptionsRequestForHost(message: SipMessage, host: string): boolean {
    const raw = message.rawMessage || '';
    const uriMatches = (message.toUri || '').includes(host) || (message.fromUri || '').includes(host);
    return message.method === 'OPTIONS' && uriMatches && /^OPTIONS\s+/im.test(raw);
  }

  private isOptionsResponseForHost(message: SipMessage, host: string): boolean {
    const raw = message.rawMessage || '';
    const uriMatches = (message.toUri || '').includes(host) || (message.fromUri || '').includes(host);
    const isOptionsCseq = /^CSeq:\s*\d+\s+OPTIONS$/im.test(raw);
    return uriMatches && isOptionsCseq && /^SIP\/2\.0\s+\d{3}/im.test(raw);
  }

  private parseSdpCodecs(raw: string): string[] {
    if (!raw.includes('m=audio')) {
      return [];
    }

    const payloads = new Set<string>();
    const dynamicNames = new Map<string, string>();
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('m=audio')) {
        trimmed.split(/\s+/).slice(3).forEach((payload) => payloads.add(payload));
        continue;
      }
      const rtpMap = trimmed.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/i);
      if (rtpMap?.[1] && rtpMap[2]) {
        dynamicNames.set(rtpMap[1], rtpMap[2]);
      }
    }

    return Array.from(payloads)
      .map((payload) => dynamicNames.get(payload) ?? this.staticPayloadCodecName(payload))
      .filter((codec): codec is string => Boolean(codec));
  }

  private staticPayloadCodecName(payload: string): string | null {
    if (payload === '0') {
      return 'PCMU';
    }
    if (payload === '8') {
      return 'PCMA';
    }
    if (payload === '9') {
      return 'G722';
    }
    if (payload === '18') {
      return 'G729';
    }
    return null;
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

  private secondsUntil(value: string | null): number | null {
    if (!value) {
      return null;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return null;
    }
    return Math.max(0, Math.floor((parsed - Date.now()) / 1000));
  }

  private extractIpFromUri(value: string | null): string | null {
    if (!value) {
      return null;
    }
    const atMatch = value.match(/@([^;>\s]+)/);
    const hostPort = (atMatch?.[1] || value.replace(/^<?(?:sip:|sips:)/i, '')).split(';')[0].replace(/>$/, '');
    const host = hostPort.startsWith('[')
      ? hostPort.slice(1, hostPort.indexOf(']'))
      : hostPort.split(':')[0];
    return host || null;
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

  private async loadKnownExtensions(): Promise<Map<string, string>> {
    const rows = await this.dataSource.query('SELECT username, display_name AS "displayName" FROM sip_extensions');
    return new Map(rows.map((row: Record<string, unknown>) => [
      String(row.username),
      row.displayName ? String(row.displayName) : String(row.username),
    ]));
  }

  private async loadKnownTrunks(): Promise<Map<string, { name: string; host: string }>> {
    const rows = await this.dataSource.query('SELECT id, name, host FROM sip_trunks');
    return new Map(rows.map((row: Record<string, unknown>) => [
      `trunk-${row.id}`,
      {
        name: row.name ? String(row.name) : `trunk-${row.id}`,
        host: row.host ? String(row.host) : '',
      },
    ]));
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
              lastSeen: this.normalizeAmiTimestamp(message.LastQualify || message.LastSeen || message.UpdateTime),
              expiresAt: this.normalizeRegExpire(message.RegExpire || message.ExpirationTime),
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

  private async getPjsipInboundRegistrationStatuses(): Promise<AmiInboundRegistrationDetail[]> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.amiHost, port: this.amiPort });
      const registrations: AmiInboundRegistrationDetail[] = [];
      const actionId = `inbound-registrations-${Date.now()}`;
      let buffer = '';
      let loggedIn = false;
      let settled = false;

      const finish = (result: AmiInboundRegistrationDetail[]) => {
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
            socket.write(`Action: PJSIPShowRegistrationInboundContactStatuses\r\nActionID: ${actionId}\r\n\r\n`);
            continue;
          }

          if (message.ActionID !== actionId) {
            continue;
          }

          if (message.Event && message.Event !== 'InboundRegistrationDetailComplete') {
            const trunkName = message.EndpointName || message.ObjectName || message.AOR || message.Registration || message.Contact || 'unknown';
            const host = this.extractIpFromUri(message.Uri || message.Contact || message.ContactURI || null) || message.Host || '';
            registrations.push({
              trunkName,
              host,
              status: this.resolveRegistrationStatus(message.Status || message.ContactStatus, Boolean(message.Uri || message.Contact)),
              lastRegistration: this.normalizeAmiTimestamp(message.LastRegistration || message.LastSeen || message.UpdateTime),
              expiresAt: this.normalizeRegExpire(message.RegExpire || message.ExpirationTime || message.Expires),
            });
            continue;
          }

          if (message.Event === 'InboundRegistrationDetailComplete' || message.Event === 'ContactStatusDetailComplete') {
            socket.write('Action: Logoff\r\n\r\n');
            finish(registrations);
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

  private normalizeAmiTimestamp(value: string | undefined): string | null {
    if (!value) {
      return null;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return new Date(numeric > 9999999999 ? numeric : numeric * 1000).toISOString();
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }

    return null;
  }
}
