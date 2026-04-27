import { OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { BackupCompleteEvent, BackupErrorEvent, BackupProgressEvent } from './backup.types';

const BACKUP_ROOM = 'backup-room';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class BackupGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    client.emit('backup:ready', { connected: true });
  }

  @SubscribeMessage('backup:subscribe')
  handleSubscribe(client: Socket): void {
    client.join(BACKUP_ROOM);
  }

  @SubscribeMessage('backup:unsubscribe')
  handleUnsubscribe(client: Socket): void {
    client.leave(BACKUP_ROOM);
  }

  emitBackupProgress(event: BackupProgressEvent): void {
    this.server.to(BACKUP_ROOM).emit('backup:progress', event);
  }

  emitBackupComplete(event: BackupCompleteEvent): void {
    this.server.to(BACKUP_ROOM).emit('backup:complete', event);
  }

  emitBackupError(event: BackupErrorEvent): void {
    this.server.to(BACKUP_ROOM).emit('backup:error', event);
  }

  emitRestoreProgress(event: BackupProgressEvent): void {
    this.server.to(BACKUP_ROOM).emit('restore:progress', event);
  }

  emitRestoreComplete(): void {
    this.server.to(BACKUP_ROOM).emit('restore:complete');
  }

  emitRestoreError(event: BackupErrorEvent): void {
    this.server.to(BACKUP_ROOM).emit('restore:error', event);
  }
}
