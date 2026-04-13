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

interface PaginatedDiagnosticsResult<T> {
  data: T[];
  total: number;
}

interface LiveExecutionItem {
  callId: string;
  events: CallTimelineEvent[];
}

const STALE_CALL_MAX_AGE_MS = 60 * 60 * 1000;
const STALE_CALL_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

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
    setInterval(() => {
      this.cleanupStaleCalls();
    }, STALE_CALL_CLEANUP_INTERVAL_MS);

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

  listSipStatuses(limit = 10, offset = 0): PaginatedDiagnosticsResult<SipEndpointStatus> {
    return this.paginate(this.getSipStatuses(), limit, offset);
  }

  getTimeline(): Record<string, CallTimelineEvent[]> {
    return Object.fromEntries(
      Array.from(this.timeline.entries()).map(([callId, events]) => [callId, events]),
    );
  }

  listTimelineCalls(limit = 10, offset = 0): PaginatedDiagnosticsResult<LiveExecutionItem> {
    const orderedCalls = Array.from(this.timeline.entries())
      .sort((a, b) => (b[1][b[1].length - 1]?.ts || 0) - (a[1][a[1].length - 1]?.ts || 0))
      .map(([callId, events]) => ({ callId, events }));

    return this.paginate(orderedCalls, limit, offset);
  }

  getTimelineForCall(callId: string): CallTimelineEvent[] | undefined {
    return this.timeline.get(callId);
  }

  getMetrics(): DiagnosticsSnapshot['metrics'] {
    const activeCalls = Array.from(this.timeline.values()).filter((events) => {
      if (events.length === 0) {
        return false;
      }
      return !this.hasTerminalEvent(events);
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

  private hasTerminalEvent(events: CallTimelineEvent[]): boolean {
    return events.some((event) => {
      const result = String(event.meta.result || '');
      return (
        event.status === 'error'
        || (event.nodeType === 'hangup' && event.status === 'completed')
        || result === 'hangup'
        || result === 'done'
        || String(event.meta.eventType || '') === 'StasisEnd'
      );
    });
  }

  private cleanupStaleCalls(): void {
    let removed = 0;
    const now = Date.now();

    for (const [callId, events] of this.timeline.entries()) {
      const lastEvent = events[events.length - 1];
      if (!lastEvent) {
        this.timeline.delete(callId);
        removed += 1;
        continue;
      }

      const ageMs = now - lastEvent.ts;
      if (ageMs > STALE_CALL_MAX_AGE_MS && !this.hasTerminalEvent(events)) {
        this.timeline.delete(callId);
        removed += 1;
      }
    }

    if (removed > 0) {
      console.log(`[diagnostics] evicted ${removed} stale call timeline entr${removed === 1 ? 'y' : 'ies'}`);
      this.gateway?.broadcastSnapshot();
      this.gateway?.broadcastSipStatuses();
    }
  }

  private paginate<T>(items: T[], limit = 10, offset = 0): PaginatedDiagnosticsResult<T> {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);

    return {
      data: items.slice(safeOffset, safeOffset + safeLimit),
      total: items.length,
    };
  }
}
