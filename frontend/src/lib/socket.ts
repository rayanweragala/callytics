import { io, type Socket } from 'socket.io-client';

const SOCKET_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export const diagnosticsSocket: Socket = io(SOCKET_BASE_URL, {
  transports: ['websocket'],
});
