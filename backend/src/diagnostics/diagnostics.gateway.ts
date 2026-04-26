import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import { Server, Socket } from 'socket.io';
import { AppLogger } from '../logger/app-logger';
import { DiagnosticsService } from './diagnostics.service';
import { CaptureService } from '../capture/capture.service';
import type { SipTrafficEvent, CallEvent, CallTimelineEvent } from './diagnostics.types';
import type { SipPacketDto } from '../capture/dto/sip-packet.dto';

const SIP_TRAFFIC_ROOM = 'sip-traffic';
const CALL_EVENTS_ROOM = 'call-events';
const CAPTURE_ROOM = 'capture-room';
const SIP_CAPTURE_STREAM = 'callytics:sip-capture';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class DiagnosticsGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new AppLogger(DiagnosticsGateway.name);
  private captureRedis: RedisClientType | null = null;
  private captureLoopRunning = false;
  private captureLastId = '$';

  constructor(
    private readonly diagnosticsService: DiagnosticsService,
    private readonly captureService: CaptureService,
  ) {}

  afterInit(): void {
    this.diagnosticsService.setGateway(this);
    void this.initializeCaptureRelay();
  }

  async onModuleDestroy(): Promise<void> {
    this.captureLoopRunning = false;
    if (this.captureRedis) {
      await this.captureRedis.disconnect().catch(() => undefined);
      this.captureRedis = null;
    }
  }

  handleConnection(client: Socket): void {
    client.emit('diagnostics:ready', { connected: true });
  }

  @SubscribeMessage('sip:traffic:subscribe')
  handleSubscribe(client: Socket): void {
    client.join(SIP_TRAFFIC_ROOM);
  }

  @SubscribeMessage('sip:traffic:unsubscribe')
  handleUnsubscribe(client: Socket): void {
    client.leave(SIP_TRAFFIC_ROOM);
  }

  @SubscribeMessage('sip:traffic:clear')
  handleClear(@MessageBody() _payload: unknown, client: Socket): void {
    client.emit('sip:traffic:cleared', { ok: true });
  }

  @SubscribeMessage('call:subscribe')
  handleCallSubscribe(client: Socket): void {
    client.join(CALL_EVENTS_ROOM);
  }

  @SubscribeMessage('call:unsubscribe')
  handleCallUnsubscribe(client: Socket): void {
    client.leave(CALL_EVENTS_ROOM);
  }

  @SubscribeMessage('capture:subscribe')
  handleCaptureSubscribe(client: Socket): void {
    client.join(CAPTURE_ROOM);
    void this.replayCapture(client);
  }

  @SubscribeMessage('capture:unsubscribe')
  handleCaptureUnsubscribe(client: Socket): void {
    client.leave(CAPTURE_ROOM);
  }

  broadcastSipTraffic(event: SipTrafficEvent): void {
    this.server.to(SIP_TRAFFIC_ROOM).emit('sip:traffic', event);
  }

  broadcastCallEvent(event: CallEvent): void {
    this.server.to(CALL_EVENTS_ROOM).emit('call:event', event);
  }

  broadcastCallTimelineEvent(event: CallTimelineEvent): void {
    this.server.to(CALL_EVENTS_ROOM).emit('call:timeline', event);
  }

  broadcastSipPacket(event: SipPacketDto): void {
    this.server.to(CAPTURE_ROOM).emit('sip:packet', event);
  }

  private async replayCapture(client: Socket): Promise<void> {
    if (!this.captureRedis?.isOpen) {
      return;
    }

    try {
      const entries = await this.captureRedis.xRevRange(SIP_CAPTURE_STREAM, '+', '-', { COUNT: 500 });
      const ordered = [...entries].reverse();
      for (const entry of ordered) {
        const packet = this.mapCaptureMessage(entry.id, entry.message as Record<string, string>);
        if (packet) {
          client.emit('sip:packet', packet);
        }
      }
    } catch (error) {
      this.logger.warn(`capture replay failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async initializeCaptureRelay(): Promise<void> {
    const redisPort = Number(process.env.REDIS_PORT || 6379);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      return;
    }

    this.captureRedis = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });

    this.captureRedis.on('error', (error) => {
      this.logger.warn(`capture relay redis error: ${error instanceof Error ? error.message : String(error)}`);
    });

    await this.captureRedis.connect().catch((error) => {
      this.logger.warn(`capture relay redis connect failed: ${error instanceof Error ? error.message : String(error)}`);
      this.captureRedis = null;
    });

    if (!this.captureRedis?.isOpen) {
      return;
    }

    this.captureLoopRunning = true;
    while (this.captureLoopRunning) {
      try {
        const rows = await this.captureRedis.xRead(
          [{ key: SIP_CAPTURE_STREAM, id: this.captureLastId }],
          { BLOCK: 1000, COUNT: 100 },
        );

        if (!rows || rows.length === 0) {
          continue;
        }

        for (const row of rows) {
          for (const message of row.messages) {
            this.captureLastId = message.id;
            const packet = this.mapCaptureMessage(message.id, message.message as Record<string, string>);
            if (packet) {
              AppLogger.redisConsume(SIP_CAPTURE_STREAM, {
                callId: packet.callId,
                method: packet.method,
                direction: packet.direction,
              });
              this.broadcastSipPacket(packet);
              try {
                await this.captureService.persistPacket(packet);
              } catch (error) {
                this.logger.error('capture packet persist failed', error instanceof Error ? error.stack : String(error));
              }
            }
          }
        }
      } catch (error) {
        if (!this.captureLoopRunning) {
          return;
        }
        this.logger.warn(`capture relay read failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private mapCaptureMessage(id: string, message: Record<string, string>): SipPacketDto | null {
    const callId = message.callId || '';

    const statusCode = Number.parseInt(message.statusCode || '', 10);
    return {
      id,
      timestamp: message.timestamp || '00:00:00.000',
      method: message.method || 'UNKNOWN',
      from: message.from || 'unknown',
      to: message.to || 'unknown',
      callId,
      direction: message.direction === 'out' ? 'out' : 'in',
      statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
      rawJson: message.rawJson || '{}',
    };
  }
}
