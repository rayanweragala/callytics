import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import { WebhookDeliveryEvent, WebhooksService } from './webhooks.service';

const REDIS_WEBHOOK_DELIVERY_CHANNEL = 'webhook:delivery';

@Injectable()
export class WebhooksListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(WebhooksListener.name);
  private subscriber: RedisClientType | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly webhooksService: WebhooksService,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);

    const redisPortRaw = process.env.REDIS_PORT;
    if (!redisPortRaw) {
      this.logger.warn('REDIS_PORT not set — WebhooksListener not started');
      return;
    }

    const redisPort = Number(redisPortRaw);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      this.logger.warn('Redis port not configured — WebhooksListener not started');
      return;
    }

    this.subscriber = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });

    this.subscriber.on('error', (error) => {
      this.logger.error(`WebhooksListener Redis error: ${error instanceof Error ? error.message : String(error)}`);
    });

    try {
      await this.subscriber.connect();
    } catch (error) {
      this.logger.warn(`WebhooksListener Redis connect failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    await this.subscriber.subscribe(REDIS_WEBHOOK_DELIVERY_CHANNEL, async (message) => {
      try {
        const event = JSON.parse(message) as WebhookDeliveryEvent;
        AppLogger.redisConsume(REDIS_WEBHOOK_DELIVERY_CHANNEL, {
          callId: event.call_id,
          flowId: event.flow_id ?? undefined,
          nodeId: event.node_id ?? undefined,
          attemptNumber: event.attempt_number,
        });
        await this.webhooksService.logDelivery(event);
        if (!event.success) {
          await this.webhooksService.scheduleRetry(event);
        }
      } catch (error) {
        this.logger.error('Failed to handle webhook delivery event', error instanceof Error ? error.stack : String(error));
      }
    });

    this.logger.log(`WebhooksListener subscribed to ${REDIS_WEBHOOK_DELIVERY_CHANNEL}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.disconnect().catch(() => undefined);
    }
  }
}
