export function jitterLabel(ms: number): string {
  if (ms < 20) return 'excellent';
  if (ms <= 50) return 'slight';
  return 'high';
}

export function packetLossLabel(pct: number): string {
  if (pct < 1) return 'none';
  if (pct <= 3) return 'low';
  return 'elevated';
}

export function rttLabel(ms: number): string {
  if (ms < 50) return 'normal';
  if (ms <= 150) return 'moderate';
  return 'high';
}

export function mosVerdict(mos: number, jitter: number, packetLoss: number): string {
  if (mos >= 4.0) return 'Call quality was excellent.';
  if (packetLoss > 3) return 'Elevated packet loss degraded audio quality.';
  if (jitter > 50) return 'High jitter caused audio instability.';
  if (mos >= 3.0) return 'Call quality was acceptable with minor issues.';
  return 'Call quality was poor — check network path and codec.';
}
