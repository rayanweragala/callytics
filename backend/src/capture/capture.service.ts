import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import type { SipPacketDto } from './dto/sip-packet.dto';

const pcapHeaders: {
  globalHeader: (snaplen?: number, linktype?: number) => Buffer;
  packetHeader: (timestamp?: number, packetSize?: number) => Buffer;
} = require('pcap-writer/lib/headers');

const SIP_CAPTURE_STREAM = 'callytics:sip-capture';
const SIP_CAPTURE_MAXLEN = 500;

@Injectable()
export class CaptureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(CaptureService.name);
  private redis: RedisClientType | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.cleanupOldPackets();
    await this.ensureRedis();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect().catch(() => undefined);
      this.redis = null;
    }
  }

  parseSipPacket(line: string): SipPacketDto | null {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      return null;
    }

    const payloadRecord = this.asRecord(payload);
    const layers = this.asRecord(payloadRecord?.layers) ?? payloadRecord;
    const callId = this.readValue(layers, ['sip.Call-ID', 'sip.call_id', 'sip.call-id', 'call_id']);
    if (!callId) {
      return null;
    }

    const statusCodeRaw = this.readValue(layers, ['sip.Status-Code', 'sip.status_code', 'sip.response.code']);
    const statusCode = statusCodeRaw ? Number.parseInt(statusCodeRaw, 10) : undefined;
    const requestMethod = this.readValue(layers, ['sip.Method', 'sip.method', 'sip.CSeq.method']);
    const method = Number.isFinite(statusCode) ? String(statusCode) : (requestMethod || 'UNKNOWN');

    const rawJson = JSON.stringify(payload);
    const timestamp = this.formatTimestamp(this.readValue(layers, ['frame.time_epoch', 'timestamp', '@timestamp']));

    return {
      id: '',
      timestamp,
      method,
      from: this.readValue(layers, ['sip.From', 'sip.from', 'sip.from.addr', 'sip.from.user']) || 'unknown',
      to: this.readValue(layers, ['sip.To', 'sip.to', 'sip.to.addr', 'sip.to.user']) || 'unknown',
      callId,
      direction: this.resolveDirection(layers),
      statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
      rawJson,
    };
  }

  async writeToRedis(packet: SipPacketDto): Promise<void> {
    if (!this.redis?.isOpen) {
      return;
    }
    try {
      const id = await this.redis.xAdd(SIP_CAPTURE_STREAM, '*', {
        timestamp: packet.timestamp,
        method: packet.method,
        from: packet.from,
        to: packet.to,
        callId: packet.callId,
        direction: packet.direction,
        statusCode: packet.statusCode === undefined ? '' : String(packet.statusCode),
        rawJson: packet.rawJson,
      });

      packet.id = id;
      AppLogger.redisPublish(SIP_CAPTURE_STREAM, {
        callId: packet.callId,
        method: packet.method,
        direction: packet.direction,
      });

      await this.redis.xTrim(SIP_CAPTURE_STREAM, 'MAXLEN', SIP_CAPTURE_MAXLEN);
    } catch (error) {
      this.logger.error(`capture redis write failed callId=${packet.callId}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async persistPacket(packet: SipPacketDto): Promise<void> {
    const normalizedCallId = packet.callId?.trim() ? packet.callId.trim() : null;
    const capturedAt = this.toIsoTimestamp(packet.timestamp);

    try {
      if (capturedAt) {
        const startedAt = Date.now();
        await this.dataSource.query(
          `
          INSERT INTO sip_packets (call_id, packet_data, captured_at)
          VALUES ($1, $2::jsonb, $3::timestamptz)
          `,
          [normalizedCallId, JSON.stringify(packet), capturedAt],
        );
        AppLogger.dbQuery('insert', 'sip_packets', startedAt);
        return;
      }

      const startedAt = Date.now();
      await this.dataSource.query(
        `
        INSERT INTO sip_packets (call_id, packet_data, captured_at)
        VALUES ($1, $2::jsonb, NOW())
        `,
        [normalizedCallId, JSON.stringify(packet)],
      );
      AppLogger.dbQuery('insert', 'sip_packets', startedAt);
    } catch (error) {
      this.logger.error(`capture db write failed callId=${packet.callId}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  async findPacketsByCallId(callId: string): Promise<SipPacketDto[]> {
    const normalized = callId.trim();
    if (!normalized) {
      return [];
    }

    const direct = await this.dataSource.query(
      `
      SELECT packet_data AS "packetData"
      FROM sip_packets
      WHERE call_id = $1
      ORDER BY captured_at ASC
      `,
      [normalized],
    );

    if (direct.length > 0) {
      return direct
        .map((row: { packetData?: SipPacketDto }) => row.packetData)
        .filter((packet): packet is SipPacketDto => Boolean(packet));
    }

    const msgRows = await this.dataSource.query(
      `
      SELECT created_at
      FROM sip_messages
      WHERE call_id = $1
      ORDER BY created_at ASC
      LIMIT 1
      `,
      [normalized],
    );
    if (!msgRows.length) {
      return [];
    }

    const callStart = new Date(msgRows[0].created_at);
    if (Number.isNaN(callStart.getTime())) {
      return [];
    }

    const sipCallIdRows = await this.dataSource.query(
      `
      SELECT DISTINCT call_id
      FROM sip_packets
      WHERE captured_at BETWEEN $1::timestamptz - INTERVAL '5 seconds'
                            AND $1::timestamptz + INTERVAL '120 seconds'
        AND call_id IS NOT NULL
        AND call_id NOT LIKE 'test-%'
      ORDER BY call_id
      `,
      [callStart.toISOString()],
    );
    if (!sipCallIdRows.length) {
      return [];
    }

    const sipCallId = sipCallIdRows[0].call_id;
    const rows = await this.dataSource.query(
      `
      SELECT packet_data AS "packetData"
      FROM sip_packets
      WHERE call_id = $1
      ORDER BY captured_at ASC
      `,
      [sipCallId],
    );
    return rows
      .map((row: { packetData?: SipPacketDto }) => row.packetData)
      .filter((packet): packet is SipPacketDto => Boolean(packet));
  }

  async getDialogPackets(callId: string): Promise<SipPacketDto[]> {
    const packets = await this.readRecentPackets();
    return packets.filter((packet) => packet.callId === callId);
  }

  async getBulkPackets(filters: {
    method?: string;
    callId?: string;
    endpoint?: string;
    from?: string;
    to?: string;
  }): Promise<SipPacketDto[]> {
    const packets = await this.readRecentPackets();
    return packets.filter((packet) => {
      if (filters.method && filters.method !== 'all' && packet.method !== filters.method) {
        return false;
      }

      if (filters.callId && !packet.callId.includes(filters.callId)) {
        return false;
      }

      if (filters.endpoint) {
        const haystack = `${packet.from} ${packet.to}`.toLowerCase();
        if (!haystack.includes(filters.endpoint.toLowerCase())) {
          return false;
        }
      }

      if (filters.from && packet.timestamp < filters.from) {
        return false;
      }

      if (filters.to && packet.timestamp > filters.to) {
        return false;
      }

      return true;
    });
  }

  async exportDialogPcap(callId: string): Promise<Buffer> {
    const packets = await this.getDialogPackets(callId);
    return this.buildPcapBuffer(packets);
  }

  async exportBulkPcap(filters: {
    method?: string;
    callId?: string;
    endpoint?: string;
    from?: string;
    to?: string;
  }): Promise<Buffer> {
    const packets = await this.getBulkPackets(filters);
    return this.buildPcapBuffer(packets);
  }

  private async readRecentPackets(): Promise<SipPacketDto[]> {
    if (!this.redis?.isOpen) {
      return [];
    }

    const entries = await this.redis.xRevRange(SIP_CAPTURE_STREAM, '+', '-', { COUNT: SIP_CAPTURE_MAXLEN });
    return entries.reverse().map((entry) => {
      const statusCode = Number.parseInt(entry.message.statusCode || '', 10);
      return {
        id: entry.id,
        timestamp: entry.message.timestamp || '00:00:00.000',
        method: entry.message.method || 'UNKNOWN',
        from: entry.message.from || 'unknown',
        to: entry.message.to || 'unknown',
        callId: entry.message.callId || '',
        direction: entry.message.direction === 'out' ? 'out' : 'in',
        statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
        rawJson: entry.message.rawJson || '{}',
      };
    });
  }

  private buildPcapBuffer(packets: SipPacketDto[]): Buffer {
    const chunks: Buffer[] = [pcapHeaders.globalHeader(65535, 1)];

    for (const packet of packets) {
      const raw = Buffer.from(packet.rawJson || '{}', 'utf8');
      const packetTimestampUsec = Date.now() * 1000;
      chunks.push(pcapHeaders.packetHeader(packetTimestampUsec, raw.length));
      chunks.push(raw);
    }

    return Buffer.concat(chunks);
  }

  private async cleanupOldPackets(): Promise<void> {
    await this.dataSource.query(`
      DELETE FROM sip_packets
      WHERE created_at < NOW() - INTERVAL '30 days'
    `);
  }

  private toIsoTimestamp(raw: string | null | undefined): string | null {
    if (!raw) {
      return null;
    }

    const directDate = new Date(raw);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate.toISOString();
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const epochDate = new Date(numeric * 1000);
      if (!Number.isNaN(epochDate.getTime())) {
        return epochDate.toISOString();
      }
    }

    return null;
  }

  private async ensureRedis(): Promise<void> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      this.logger.warn('Invalid REDIS_PORT — capture stream disabled');
      return;
    }

    this.redis = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });

    this.redis.on('error', (error) => {
      this.logger.warn(`capture redis error: ${error instanceof Error ? error.message : String(error)}`);
    });

    await this.redis.connect().catch((error) => {
      this.logger.warn(`capture redis connect failed: ${error instanceof Error ? error.message : String(error)}`);
      this.redis = null;
    });
  }

  private readValue(source: unknown, keys: string[]): string | null {
    if (!source || typeof source !== 'object') {
      return null;
    }

    for (const key of keys) {
      const value = (source as Record<string, unknown>)[key];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === 'string' && item.trim());
        if (typeof first === 'string') {
          return first;
        }
      }
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    return null;
  }

  private formatTimestamp(raw: string | null): string {
    if (!raw) {
      return '00:00:00.000';
    }

    const numeric = Number(raw);
    const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return '00:00:00.000';
    }

    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  private resolveDirection(layers: unknown): 'in' | 'out' {
    if (!layers || typeof layers !== 'object') {
      return 'in';
    }

    const srcPort = this.readValue(layers, ['udp.srcport', 'tcp.srcport']);
    const dstPort = this.readValue(layers, ['udp.dstport', 'tcp.dstport']);
    if (srcPort === '5060' && dstPort !== '5060') {
      return 'out';
    }

    return 'in';
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }
}
