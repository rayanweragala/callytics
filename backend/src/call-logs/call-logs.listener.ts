import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { AppLogger } from '../logger/app-logger';

interface CallStartedEvent {
  callId: string;
  timestamp: string;
  type: 'started';
  caller: string;
  callerId?: string;
  destination?: string;
  direction?: 'inbound' | 'outbound';
  flowId?: number;
  flowVersionId?: number;
  entryNodeKey?: string;
  startedAt?: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  duration?: number | null;
  trunkId?: number | null;
  recorded?: boolean;
}

interface CallEndedEvent {
  callId: string;
  timestamp: string;
  type: 'ended';
  caller: string;
  callerId?: string;
  durationSeconds?: number;
  exitNodeKey?: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  duration?: number | null;
  trunkId?: number | null;
  recorded?: boolean;
}

interface CallFailedEvent {
  callId: string;
  timestamp: string;
  type: 'failed';
  caller: string;
  callerId?: string;
  destination?: string;
  direction?: 'inbound' | 'outbound';
  flowId?: number;
  flowVersionId?: number;
  failedNode?: string;
  failureReason?: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  duration?: number | null;
  trunkId?: number | null;
  recorded?: boolean;
}

type CallEvent = CallStartedEvent | CallEndedEvent | CallFailedEvent;

const REDIS_CALL_EVENTS_CHANNEL = 'callytics:call-events';

@Injectable()
export class CallLogsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(CallLogsListener.name);
  private subscriber: RedisClientType | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const redisPortRaw = process.env.REDIS_PORT;
    if (!redisPortRaw) {
      this.logger.warn('REDIS_PORT not set — CallLogsListener not started');
      return;
    }

    const redisPort = Number(redisPortRaw);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      this.logger.warn('Redis port not configured — CallLogsListener not started');
      return;
    }

    this.subscriber = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });

    this.subscriber.on('error', (error) => {
      this.logger.error(`CallLogsListener Redis error: ${error instanceof Error ? error.message : String(error)}`);
    });

    try {
      await this.subscriber.connect();
    } catch (error) {
      this.logger.warn(`CallLogsListener Redis connect failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    await this.subscriber.subscribe(REDIS_CALL_EVENTS_CHANNEL, async (message) => {
      try {
        const event = JSON.parse(message) as CallEvent;
        AppLogger.redisConsume(REDIS_CALL_EVENTS_CHANNEL, {
          callId: event.callId,
          type: event.type,
          flowId: 'flowId' in event ? event.flowId : undefined,
        });
        await this.handleCallEvent(event);
      } catch (error) {
        this.logger.error('Failed to handle call event', error instanceof Error ? error.stack : String(error));
      }
    });

    this.logger.log('CallLogsListener subscribed to callytics:call-events');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.disconnect().catch(() => undefined);
    }
  }

  private async handleCallEvent(event: CallEvent): Promise<void> {
    if (event.type === 'started') {
      await this.handleCallStarted(event);
    } else if (event.type === 'ended') {
      await this.handleCallEnded(event);
    } else if (event.type === 'failed') {
      await this.handleCallFailed(event);
    }
  }

  private async handleCallStarted(event: CallStartedEvent): Promise<void> {
    try {
      const startedAtValue = event.startedAt || event.timestamp;
      const startedAt = Date.now();
      await this.dataSource.query(
        `
          INSERT INTO call_logs (
            call_uuid,
            direction,
            caller_number,
            callee_number,
            started_at,
            flow_id,
            flow_version_id,
            entry_node_key,
            trunk_id,
            recorded
          )
          VALUES ($1, $8, $2, $3, $4::timestamptz, $5, $6, $7, $9, $10)
          ON CONFLICT (call_uuid) DO NOTHING
        `,
        [
          event.callId,
          event.callerId || event.caller || null,
          event.destination || null,
          startedAtValue,
          event.flowId ?? null,
          event.flowVersionId ?? null,
          event.entryNodeKey ?? null,
          event.direction || 'inbound',
          event.trunkId ?? null,
          Boolean(event.recorded),
        ],
      );
      AppLogger.dbQuery('insert', 'call_logs', startedAt);
    } catch (error) {
      this.logger.error(`call_logs INSERT failed for ${event.callId}`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async handleCallEnded(event: CallEndedEvent): Promise<void> {
    try {
      const durationSeconds = typeof event.duration === 'number'
        ? event.duration
        : typeof event.durationSeconds === 'number'
          ? event.durationSeconds
          : null;
      // 1. Update ended_at, duration, and exit_node_key regardless of status, but only if ended_at is NULL
      const updateStartedAt = Date.now();
      await this.dataSource.query(
        `
          UPDATE call_logs
          SET ended_at         = $2::timestamptz,
              answered_at      = COALESCE($3::timestamptz, answered_at),
              duration_seconds = $4,
              exit_node_key    = $5
          WHERE call_uuid = $1
            AND ended_at IS NULL
        `,
        [
          event.callId,
          event.endedAt || event.timestamp,
          event.answeredAt || null,
          durationSeconds,
          event.exitNodeKey ?? null,
        ],
      );
      AppLogger.dbQuery('update', 'call_logs', updateStartedAt);

      // 2. Only set end_reason to 'completed' if it hasn't been set by a 'failed' event already
      const reasonStartedAt = Date.now();
      await this.dataSource.query(
        `
          UPDATE call_logs
          SET end_reason = 'completed'
          WHERE call_uuid = $1
            AND end_reason IS NULL
        `,
        [event.callId],
      );
      AppLogger.dbQuery('update', 'call_logs', reasonStartedAt);
    } catch (error) {
      this.logger.error(`call_logs UPDATE (ended) failed for ${event.callId}`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async handleCallFailed(event: CallFailedEvent): Promise<void> {
    try {
      const durationSeconds = typeof event.duration === 'number' ? event.duration : null;
      const endedAtValue = event.endedAt || event.timestamp;
      // Upsert: insert if stasis never emitted 'started', then mark failed
      const startedAt = Date.now();
      await this.dataSource.query(
        `
          INSERT INTO call_logs (
            call_uuid,
            direction,
            caller_number,
            callee_number,
            started_at,
            ended_at,
            answered_at,
            end_reason,
            duration_seconds,
            flow_id,
            flow_version_id,
            exit_node_key,
            trunk_id,
            recorded
          )
          VALUES ($1, $11, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, 'failed', $7, $8, $9, $10, $12, $13)
          ON CONFLICT (call_uuid) DO UPDATE
            SET ended_at         = EXCLUDED.ended_at,
                answered_at      = COALESCE(EXCLUDED.answered_at, call_logs.answered_at),
                end_reason       = 'failed',
                duration_seconds = COALESCE(EXCLUDED.duration_seconds, call_logs.duration_seconds),
                exit_node_key    = EXCLUDED.exit_node_key,
                trunk_id         = COALESCE(EXCLUDED.trunk_id, call_logs.trunk_id),
                recorded         = call_logs.recorded OR EXCLUDED.recorded
          WHERE call_logs.ended_at IS NULL
        `,
        [
          event.callId,
          event.callerId || event.caller || null,
          event.destination || null,
          event.timestamp,
          endedAtValue,
          event.answeredAt || null,
          durationSeconds,
          event.flowId ?? null,
          event.flowVersionId ?? null,
          event.failedNode ?? null,
          event.direction || 'inbound',
          event.trunkId ?? null,
          Boolean(event.recorded),
        ],
      );
      AppLogger.dbQuery('upsert', 'call_logs', startedAt);
    } catch (error) {
      this.logger.error(`call_logs UPSERT (failed) failed for ${event.callId}`, error instanceof Error ? error.stack : String(error));
    }
  }
}
