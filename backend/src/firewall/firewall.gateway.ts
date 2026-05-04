import { OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { FirewallBlockedIp, FirewallFeedEvent, FirewallStats } from './firewall.types';

const FIREWALL_ROOM = 'firewall-room';

@WebSocketGateway({ cors: { origin: '*' } })
export class FirewallGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    client.emit('firewall:ready', { connected: true });
  }

  @SubscribeMessage('firewall:subscribe')
  handleSubscribe(client: Socket): void {
    client.join(FIREWALL_ROOM);
  }

  @SubscribeMessage('firewall:unsubscribe')
  handleUnsubscribe(client: Socket): void {
    client.leave(FIREWALL_ROOM);
  }

  emitBlocked(event: FirewallBlockedIp): void {
    this.server.to(FIREWALL_ROOM).emit('firewall:blocked', event);
  }

  emitAllowed(event: FirewallFeedEvent): void {
    this.server.to(FIREWALL_ROOM).emit('firewall:allowed', event);
  }

  emitFeed(event: FirewallFeedEvent): void {
    this.server.to(FIREWALL_ROOM).emit('firewall:feed', event);
  }

  emitStats(stats: FirewallStats): void {
    this.server.to(FIREWALL_ROOM).emit('firewall:stats', stats);
  }
}
