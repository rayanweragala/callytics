import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createClient, RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { DiagnosticsGateway } from './diagnostics.gateway';
import {
  CallTimelineEvent,
  DiagnosticsSnapshot,
  SipEndpointStatus,
} from './diagnostics.types';

interface RedisSipStatusMessage {
  ts: number;
  endpoints: SipEndpointStatus[];
}

@Injectable()
export class DiagnosticsService implements OnModuleInit {
  private readonly startedAt = Date.now();
  private readonly sipStatuses = new Map<string, SipEndpointStatus>();
  private readonly timeline = new Map<string, CallTimelineEvent[]>();
  private redisSubscriber: RedisClientType | null = null;
  private gateway: DiagnosticsGateway | null = null;
  private flowCount = 0;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  setGateway(gateway: DiagnosticsGateway): void {
    this.gateway = gateway;
  }

  async onModuleInit(): Promise<void> {
    await this.refreshFlowCount();
    setInterval(() => {
      void this.refreshFlowCount();
    }, 10000);

    this.redisSubscriber = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'redis',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    });

    this.redisSubscriber.on('error', (error) => {
      console.error('Diagnostics Redis subscriber error:', error);
    });

    await this.redisSubscriber.connect();

    await this.redisSubscriber.subscribe('callytics:sip-status', async (message) => {
      const payload = JSON.parse(message) as RedisSipStatusMessage;
      this.sipStatuses.clear();
      for (const endpoint of payload.endpoints) {
        this.sipStatuses.set(endpoint.endpoint, endpoint);
      }
      console.log(`[diagnostics] received sip status update for ${payload.endpoints.length} endpoints`);
      this.gateway?.broadcastSipStatuses();
    });

    await this.redisSubscriber.subscribe('callytics:call-timeline', async (message) => {
      const event = JSON.parse(message) as CallTimelineEvent;
      const existing = this.timeline.get(event.callId) || [];
      const next = [...existing, event].slice(-50);
      this.timeline.set(event.callId, next);
      console.log(`[diagnostics] relaying timeline event ${event.nodeType}:${event.status} for ${event.callId}`);
      this.gateway?.broadcastTimeline(event.callId);
    });
  }

  async refreshFlowCount(): Promise<void> {
    const result = await this.dataSource.query('SELECT COUNT(*)::int AS count FROM call_flows');
    this.flowCount = Number(result[0]?.count || 0);
    this.gateway?.broadcastSnapshot();
  }

  getSipStatuses(): SipEndpointStatus[] {
    return Array.from(this.sipStatuses.values()).sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  }

  getTimeline(): Record<string, CallTimelineEvent[]> {
    return Object.fromEntries(
      Array.from(this.timeline.entries()).map(([callId, events]) => [callId, events]),
    );
  }

  getTimelineForCall(callId: string): CallTimelineEvent[] | undefined {
    return this.timeline.get(callId);
  }

  getMetrics(): DiagnosticsSnapshot['metrics'] {
    const activeCalls = Array.from(this.timeline.values()).filter((events) => {
      const lastEvent = events[events.length - 1];
      if (!lastEvent) {
        return false;
      }
      const result = String(lastEvent.meta.result || '');
      return result !== 'hangup' && result !== 'done' && lastEvent.status !== 'error';
    }).length;

    const registeredEndpoints = this.getSipStatuses().filter((status) => status.state === 'registered').length;

    return {
      activeCalls,
      registeredEndpoints,
      flows: this.flowCount,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  getSnapshot(): DiagnosticsSnapshot {
    return {
      metrics: this.getMetrics(),
      sipStatuses: this.getSipStatuses(),
      timeline: this.getTimeline(),
    };
  }
}
