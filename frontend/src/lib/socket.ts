import { io, type Socket } from 'socket.io-client';

export const diagnosticsSocket: Socket = io('http://localhost:3001', {
  transports: ['websocket'],
});
