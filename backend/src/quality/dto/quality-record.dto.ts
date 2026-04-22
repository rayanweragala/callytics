export class QualityRecordDto {
  callId: string;
  mos: number;
  jitter: number;
  packetLoss: number;
  rtt: number;
  grade: string;
  recordedAt: string;
}
