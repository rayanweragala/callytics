import {
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DiagnosticsService } from './diagnostics.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class DiagnosticsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly diagnosticsService: DiagnosticsService) {
    this.diagnosticsService.setGateway(this);
  }

  handleConnection(client: Socket): void {
    client.emit('diagnostics:bootstrap', this.diagnosticsService.getSnapshot());
  }

  @SubscribeMessage('diagnostics:live-execution:list')
  handleLiveExecutionList(
    @MessageBody() payload: { limit?: number; offset?: number } = {},
  ) {
    return this.diagnosticsService.listTimelineCalls(payload.limit ?? 10, payload.offset ?? 0);
  }

  @SubscribeMessage('diagnostics:sip-status:list')
  handleSipStatusList(
    @MessageBody() payload: { limit?: number; offset?: number } = {},
  ) {
    return this.diagnosticsService.listSipStatuses(payload.limit ?? 10, payload.offset ?? 0);
  }

  broadcastSnapshot(): void {
    this.server.emit('diagnostics:bootstrap', this.diagnosticsService.getSnapshot());
  }

  broadcastSipStatuses(): void {
    this.server.emit('diagnostics:sip-status', this.diagnosticsService.getSipStatuses());
    this.server.emit('diagnostics:metrics', this.diagnosticsService.getMetrics());
  }

  broadcastTimeline(callId: string): void {
    const timeline = this.diagnosticsService.getTimelineForCall(callId);
    if (!timeline) {
      return;
    }

    this.server.emit('diagnostics:timeline', {
      callId,
      events: timeline,
    });
    this.server.emit('diagnostics:metrics', this.diagnosticsService.getMetrics());
  }
}
