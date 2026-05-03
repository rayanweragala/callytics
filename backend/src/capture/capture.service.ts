import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import type { SipPacketDto } from './dto/sip-packet.dto';

const SIP_CAPTURE_STREAM = 'callytics:sip-capture';
const SIP_CAPTURE_MAXLEN = 500;
const PCAP_MAGIC_USEC = 0xa1b2c3d4;
const PCAP_VERSION_MAJOR = 2;
const PCAP_VERSION_MINOR = 4;
const PCAP_SNAPLEN = 65535;
const LINKTYPE_RAW = 101;

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
    const chunks: Buffer[] = [this.buildPcapGlobalHeader()];

    for (const packet of packets) {
      const packetBytes = this.buildRawIpv4UdpPacket(packet);
      const tsUsec = this.resolvePacketTimestampUsec(packet);
      chunks.push(this.buildPcapPacketHeader(tsUsec, packetBytes.length));
      chunks.push(packetBytes);
    }

    return Buffer.concat(chunks);
  }

  private buildPcapGlobalHeader(): Buffer {
    const header = Buffer.alloc(24);
    header.writeUInt32LE(PCAP_MAGIC_USEC, 0);
    header.writeUInt16LE(PCAP_VERSION_MAJOR, 4);
    header.writeUInt16LE(PCAP_VERSION_MINOR, 6);
    header.writeInt32LE(0, 8);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(PCAP_SNAPLEN, 16);
    header.writeUInt32LE(LINKTYPE_RAW, 20);
    return header;
  }

  private buildPcapPacketHeader(timestampUsec: number, packetLength: number): Buffer {
    const header = Buffer.alloc(16);
    const tsSec = Math.floor(timestampUsec / 1_000_000);
    const tsUsec = timestampUsec - (tsSec * 1_000_000);
    header.writeUInt32LE(tsSec >>> 0, 0);
    header.writeUInt32LE(tsUsec >>> 0, 4);
    header.writeUInt32LE(packetLength >>> 0, 8);
    header.writeUInt32LE(packetLength >>> 0, 12);
    return header;
  }

  private buildRawIpv4UdpPacket(packet: SipPacketDto): Buffer {
    const payload = this.extractPacketPayload(packet);
    const ipHeaderLength = 20;
    const udpHeaderLength = 8;
    const totalLength = ipHeaderLength + udpHeaderLength + payload.length;

    const ipHeader = Buffer.alloc(ipHeaderLength);
    ipHeader[0] = 0x45;
    ipHeader[1] = 0x00;
    ipHeader.writeUInt16BE(totalLength, 2);
    ipHeader.writeUInt16BE(0, 4);
    ipHeader.writeUInt16BE(0x4000, 6);
    ipHeader[8] = 64;
    ipHeader[9] = 17; // UDP
    ipHeader.writeUInt16BE(0, 10);

    const sourceIp = packet.direction === 'out' ? [10, 0, 0, 2] : [10, 0, 0, 1];
    const destinationIp = packet.direction === 'out' ? [10, 0, 0, 1] : [10, 0, 0, 2];
    ipHeader.set(sourceIp, 12);
    ipHeader.set(destinationIp, 16);
    ipHeader.writeUInt16BE(this.calculateIpv4HeaderChecksum(ipHeader), 10);

    const udpHeader = Buffer.alloc(udpHeaderLength);
    const sourcePort = packet.direction === 'out' ? 5060 : 50600;
    const destinationPort = packet.direction === 'out' ? 50600 : 5060;
    udpHeader.writeUInt16BE(sourcePort, 0);
    udpHeader.writeUInt16BE(destinationPort, 2);
    udpHeader.writeUInt16BE(udpHeaderLength + payload.length, 4);
    udpHeader.writeUInt16BE(0, 6);

    return Buffer.concat([ipHeader, udpHeader, payload]);
  }

  private calculateIpv4HeaderChecksum(header: Buffer): number {
    let sum = 0;
    for (let i = 0; i < header.length; i += 2) {
      sum += header.readUInt16BE(i);
      while (sum > 0xffff) {
        sum = (sum & 0xffff) + (sum >>> 16);
      }
    }
    return (~sum) & 0xffff;
  }

  private resolvePacketTimestampUsec(packet: SipPacketDto): number {
    const fromRawJson = this.extractEpochFromRawJson(packet.rawJson);
    if (fromRawJson !== null) {
      return fromRawJson;
    }

    const direct = Date.parse(packet.timestamp);
    if (Number.isFinite(direct) && direct > 0) {
      return Math.floor(direct * 1000);
    }

    const hhmmss = packet.timestamp.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/);
    if (hhmmss) {
      const now = new Date();
      const ms = Number((hhmmss[4] || '0').padEnd(3, '0').slice(0, 3));
      const local = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        Number(hhmmss[1]),
        Number(hhmmss[2]),
        Number(hhmmss[3]),
        ms,
      );
      return Math.floor(local.getTime() * 1000);
    }

    return Date.now() * 1000;
  }

  private extractEpochFromRawJson(rawJson: string): number | null {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const root = this.asRecord(parsed);
      const layers = this.asRecord(root?.layers) ?? root;
      const rawEpoch = this.readValue(layers, ['frame.time_epoch', 'timestamp', '@timestamp']);
      if (!rawEpoch) {
        return null;
      }
      const numeric = Number(rawEpoch);
      if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric * 1_000_000);
      }
      const parsedTime = Date.parse(rawEpoch);
      if (Number.isFinite(parsedTime) && parsedTime > 0) {
        return Math.floor(parsedTime * 1000);
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractPacketPayload(packet: SipPacketDto): Buffer {
    try {
      const parsed = JSON.parse(packet.rawJson) as unknown;
      const root = this.asRecord(parsed);
      const layers = this.asRecord(root?.layers) ?? root;
      const sipHeaders = this.readValue(layers, ['sip.msg_hdr', 'sip.msg_header', 'sip.msgheader']);
      const sipBody = this.readValue(layers, ['sip.msg_body', 'sip.msgbody']);
      if (sipHeaders && sipBody) {
        return Buffer.from(`${sipHeaders}\r\n\r\n${sipBody}`, 'utf8');
      }
      if (sipHeaders) {
        return Buffer.from(sipHeaders, 'utf8');
      }
      if (sipBody) {
        return Buffer.from(sipBody, 'utf8');
      }
    } catch {
      // Fall back to rawJson below.
    }
    return Buffer.from(packet.rawJson || '{}', 'utf8');
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
