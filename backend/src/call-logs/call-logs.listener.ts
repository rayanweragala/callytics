import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';

interface CallStartedEvent {
  callId: string;
  timestamp: string;
  type: 'started';
  caller: string;
  flowId?: number;
  flowVersionId?: number;
  entryNodeKey?: string;
}

interface CallEndedEvent {
  callId: string;
  timestamp: string;
  type: 'ended';
  caller: string;
  durationSeconds?: number;
  exitNodeKey?: string;
}

interface CallFailedEvent {
  callId: string;
  timestamp: string;
  type: 'failed';
  caller: string;
  flowId?: number;
  flowVersionId?: number;
  failedNode?: string;
  failureReason?: string;
}

type CallEvent = CallStartedEvent | CallEndedEvent | CallFailedEvent;

const REDIS_CALL_EVENTS_CHANNEL = 'callytics:call-events';

@Injectable()
export class CallLogsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallLogsListener.name);
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
        await this.handleCallEvent(event);
      } catch (error) {
        this.logger.warn(`Failed to handle call event: ${error instanceof Error ? error.message : String(error)}`);
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
            entry_node_key
          )
          VALUES ($1, 'inbound', $2, NULL, $3::timestamptz, $4, $5, $6)
          ON CONFLICT (call_uuid) DO NOTHING
        `,
        [
          event.callId,
          event.caller || null,
          event.timestamp,
          event.flowId ?? null,
          event.flowVersionId ?? null,
          event.entryNodeKey ?? null,
        ],
      );
      this.logger.debug(`call_logs INSERT for ${event.callId}`);
    } catch (error) {
      this.logger.error(`call_logs INSERT failed for ${event.callId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleCallEnded(event: CallEndedEvent): Promise<void> {
    try {
      // 1. Update ended_at, duration, and exit_node_key regardless of status, but only if ended_at is NULL
      await this.dataSource.query(
        `
          UPDATE call_logs
          SET ended_at       = $2::timestamptz,
              duration_seconds = $3,
              exit_node_key   = $4
          WHERE call_uuid = $1
            AND ended_at IS NULL
        `,
        [
          event.callId,
          event.timestamp,
          typeof event.durationSeconds === 'number' ? event.durationSeconds : null,
          event.exitNodeKey ?? null,
        ],
      );

      // 2. Only set end_reason to 'completed' if it hasn't been set by a 'failed' event already
      await this.dataSource.query(
        `
          UPDATE call_logs
          SET end_reason = 'completed'
          WHERE call_uuid = $1
            AND end_reason IS NULL
        `,
        [event.callId],
      );
      this.logger.debug(`call_logs UPDATE (ended) for ${event.callId}`);
    } catch (error) {
      this.logger.error(`call_logs UPDATE (ended) failed for ${event.callId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleCallFailed(event: CallFailedEvent): Promise<void> {
    try {
      // Upsert: insert if stasis never emitted 'started', then mark failed
      await this.dataSource.query(
        `
          INSERT INTO call_logs (
            call_uuid,
            direction,
            caller_number,
            callee_number,
            started_at,
            ended_at,
            end_reason,
            flow_id,
            flow_version_id,
            exit_node_key
          )
          VALUES ($1, 'inbound', $2, NULL, $3::timestamptz, $3::timestamptz, 'failed', $4, $5, $6)
          ON CONFLICT (call_uuid) DO UPDATE
            SET ended_at     = EXCLUDED.ended_at,
                end_reason   = 'failed',
                exit_node_key = EXCLUDED.exit_node_key
          WHERE call_logs.ended_at IS NULL
        `,
        [
          event.callId,
          event.caller || null,
          event.timestamp,
          event.flowId ?? null,
          event.flowVersionId ?? null,
          event.failedNode ?? null,
        ],
      );
      this.logger.debug(`call_logs UPSERT (failed) for ${event.callId}`);
    } catch (error) {
      this.logger.error(`call_logs UPSERT (failed) failed for ${event.callId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
