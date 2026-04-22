import {
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DiagnosticsService } from './diagnostics.service';
import type { SipTrafficEvent, CallEvent, CallTimelineEvent } from './diagnostics.types';

const SIP_TRAFFIC_ROOM = 'sip-traffic';
const CALL_EVENTS_ROOM = 'call-events';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class DiagnosticsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  afterInit(): void {
    this.diagnosticsService.setGateway(this);
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

  broadcastSipTraffic(event: SipTrafficEvent): void {
    this.server.to(SIP_TRAFFIC_ROOM).emit('sip:traffic', event);
  }

  broadcastCallEvent(event: CallEvent): void {
    this.server.to(CALL_EVENTS_ROOM).emit('call:event', event);
  }

  broadcastCallTimelineEvent(event: CallTimelineEvent): void {
    this.server.to(CALL_EVENTS_ROOM).emit('call:timeline', event);
  }
}
