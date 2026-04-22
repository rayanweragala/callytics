export interface RtcpDirection {
  jitter: number;
  packetLoss: number;
  rtt: number;
}

export interface MosResult {
  mos: number;
  grade: 'good' | 'fair' | 'poor';
}

export function computeMos(direction: RtcpDirection): MosResult {
  const R = 93.2 - (direction.jitter * 0.2) - (direction.packetLoss * 2.5);
  let mos: number;
  if (R <= 0) {
    mos = 1.0;
  } else if (R >= 100) {
    mos = 5.0;
  } else {
    mos = 1 + 0.035 * R + R * (R - 60) * (100 - R) * 0.000007;
    mos = Math.max(1.0, Math.min(5.0, mos));
  }
  mos = Math.round(mos * 100) / 100;

  const grade: MosResult['grade'] =
    mos >= 4.0 ? 'good' :
    mos >= 3.0 ? 'fair' :
    'poor';

  return { mos, grade };
}

export function worseDirection(a: RtcpDirection, b: RtcpDirection): RtcpDirection {
  return {
    jitter: Math.max(a.jitter, b.jitter),
    packetLoss: Math.max(a.packetLoss, b.packetLoss),
    rtt: Math.max(a.rtt, b.rtt),
  };
}
