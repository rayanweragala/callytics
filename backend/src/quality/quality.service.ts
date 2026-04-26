import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import { QualityRecordDto } from './dto/quality-record.dto';

const STREAM_KEY = 'callytics:rtp-quality';
const STREAM_GROUP = 'quality-consumers';

interface StreamPayload {
  callId: string;
  mos: number;
  jitter: number;
  packetLoss: number;
  rtt: number;
  grade: 'good' | 'fair' | 'poor';
  recordedAt: string;
}

@Injectable()
export class QualityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(QualityService.name);
  private redis: RedisClientType | null = null;
  private running = false;
  private consumerName = `quality-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private consumePromise: Promise<void> | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.ensureRedis();
    if (!this.redis?.isOpen) {
      return;
    }

    await this.ensureConsumerGroup();
    this.running = true;
    this.consumePromise = this.consumeLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.consumePromise?.catch(() => undefined);
    if (this.redis?.isOpen) {
      await this.redis.disconnect().catch(() => undefined);
    }
    this.redis = null;
  }

  async findByCallId(callId: string): Promise<QualityRecordDto | null> {
    const rows = await this.dataSource.query(
      `
      SELECT
        call_id AS "callId",
        mos,
        jitter,
        packet_loss AS "packetLoss",
        rtt,
        grade,
        recorded_at AS "recordedAt"
      FROM call_quality
      WHERE call_id = $1
      LIMIT 1
      `,
      [callId],
    );

    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }

    return {
      callId: String(row.callId),
      mos: Number(row.mos),
      jitter: Number(row.jitter),
      packetLoss: Number(row.packetLoss),
      rtt: Number(row.rtt),
      grade: String(row.grade),
      recordedAt: new Date(String(row.recordedAt)).toISOString(),
    };
  }

  private async ensureRedis(): Promise<void> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      this.logger.warn('Invalid REDIS_PORT — quality stream disabled');
      return;
    }

    this.redis = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });

    this.redis.on('error', (error) => {
      this.logger.warn(`quality redis error: ${error instanceof Error ? error.message : String(error)}`);
    });

    await this.redis.connect().catch((error) => {
      this.logger.warn(`quality redis connect failed: ${error instanceof Error ? error.message : String(error)}`);
      this.redis = null;
    });
  }

  private async ensureConsumerGroup(): Promise<void> {
    if (!this.redis?.isOpen) {
      return;
    }

    try {
      await this.redis.xGroupCreate(STREAM_KEY, STREAM_GROUP, '0', { MKSTREAM: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  private async consumeLoop(): Promise<void> {
    while (this.running && this.redis?.isOpen) {
      try {
        const rows = await this.redis.xReadGroup(
          STREAM_GROUP,
          this.consumerName,
          [{ key: STREAM_KEY, id: '>' }],
          { BLOCK: 1000, COUNT: 25 },
        );

        if (!rows || rows.length === 0) {
          continue;
        }

        for (const row of rows) {
          for (const message of row.messages) {
            await this.processStreamMessage(message.message as Record<string, string>);
            await this.redis.xAck(STREAM_KEY, STREAM_GROUP, message.id);
          }
        }
      } catch (error) {
        if (!this.running) {
          return;
        }
        this.logger.warn(`quality stream read failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async processStreamMessage(message: Record<string, string>): Promise<void> {
    const raw = message.data;
    if (!raw) {
      return;
    }

    let parsed: StreamPayload;
    try {
      parsed = JSON.parse(raw) as StreamPayload;
    } catch {
      return;
    }

    if (!parsed.callId || !parsed.recordedAt) {
      return;
    }

    AppLogger.redisConsume(STREAM_KEY, {
      callId: parsed.callId,
      grade: parsed.grade,
      recordedAt: parsed.recordedAt,
    });
    await this.upsertQuality(parsed);
  }

  private async upsertQuality(payload: StreamPayload): Promise<void> {
    const callId = String(payload.callId);
    const mos = Number(payload.mos);
    const jitter = Number(payload.jitter);
    const packetLoss = Number(payload.packetLoss);
    const rtt = Number(payload.rtt);
    const recordedAt = new Date(payload.recordedAt).toISOString();

    if (!Number.isFinite(mos) || !Number.isFinite(jitter) || !Number.isFinite(packetLoss) || !Number.isFinite(rtt)) {
      return;
    }

    const startedAt = Date.now();
    await this.dataSource.query(
      `
      INSERT INTO call_quality (
        call_id,
        mos,
        jitter,
        packet_loss,
        rtt,
        grade,
        recorded_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      ON CONFLICT (call_id) DO UPDATE SET
        mos = LEAST(COALESCE(call_quality.mos, EXCLUDED.mos), EXCLUDED.mos),
        jitter = GREATEST(COALESCE(call_quality.jitter, EXCLUDED.jitter), EXCLUDED.jitter),
        packet_loss = GREATEST(COALESCE(call_quality.packet_loss, EXCLUDED.packet_loss), EXCLUDED.packet_loss),
        rtt = GREATEST(COALESCE(call_quality.rtt, EXCLUDED.rtt), EXCLUDED.rtt),
        grade = CASE
          WHEN LEAST(COALESCE(call_quality.mos, EXCLUDED.mos), EXCLUDED.mos) >= 4.0 THEN 'good'
          WHEN LEAST(COALESCE(call_quality.mos, EXCLUDED.mos), EXCLUDED.mos) >= 3.0 THEN 'fair'
          ELSE 'poor'
        END,
        recorded_at = EXCLUDED.recorded_at
      WHERE
        COALESCE(EXCLUDED.mos, 5) < COALESCE(call_quality.mos, 5)
        OR COALESCE(EXCLUDED.jitter, 0) > COALESCE(call_quality.jitter, 0)
        OR COALESCE(EXCLUDED.packet_loss, 0) > COALESCE(call_quality.packet_loss, 0)
        OR COALESCE(EXCLUDED.rtt, 0) > COALESCE(call_quality.rtt, 0)
      `,
      [
        callId,
        mos,
        jitter,
        packetLoss,
        rtt,
        payload.grade,
        recordedAt,
      ],
    );
    AppLogger.dbQuery('upsert', 'call_quality', startedAt);
  }
}
