export interface SipPacketDto {
  id: string;
  timestamp: string;
  method: string;
  from: string;
  to: string;
  callId: string;
  direction: 'in' | 'out';
  statusCode?: number;
  rawJson: string;
}
