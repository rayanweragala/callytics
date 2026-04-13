import {
  OnGatewayConnection,
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
