import { io, type Socket } from 'socket.io-client';
import { getSocketBaseUrl, getSocketPath } from './backendBaseUrl';

const SOCKET_BASE_URL = getSocketBaseUrl();

export const diagnosticsSocket: Socket = io(SOCKET_BASE_URL, {
  transports: ['websocket'],
  path: getSocketPath(),
});
