import { describe, expect, it } from 'vitest';
import { jitterLabel, mosVerdict, packetLossLabel, rttLabel } from './mosLabel';

describe('jitterLabel', () => {
  it('returns excellent when jitter < 20', () => {
    expect(jitterLabel(19.9)).toBe('excellent');
  });

  it('returns slight when 20 <= jitter <= 50', () => {
    expect(jitterLabel(20)).toBe('slight');
    expect(jitterLabel(50)).toBe('slight');
  });

  it('returns high when jitter > 50', () => {
    expect(jitterLabel(50.1)).toBe('high');
  });
});

describe('packetLossLabel', () => {
  it('returns none when loss < 1', () => {
    expect(packetLossLabel(0.9)).toBe('none');
  });

  it('returns low when 1 <= loss <= 3', () => {
    expect(packetLossLabel(1)).toBe('low');
    expect(packetLossLabel(3)).toBe('low');
  });

  it('returns elevated when loss > 3', () => {
    expect(packetLossLabel(3.1)).toBe('elevated');
  });
});

describe('rttLabel', () => {
  it('returns normal when rtt < 50', () => {
    expect(rttLabel(49)).toBe('normal');
  });

  it('returns moderate when 50 <= rtt <= 150', () => {
    expect(rttLabel(50)).toBe('moderate');
    expect(rttLabel(150)).toBe('moderate');
  });

  it('returns high when rtt > 150', () => {
    expect(rttLabel(151)).toBe('high');
  });
});

describe('mosVerdict', () => {
  it('returns excellent verdict when mos >= 4.0', () => {
    expect(mosVerdict(4.0, 999, 999)).toBe('Call quality was excellent.');
  });

  it('returns packet-loss verdict when mos < 4.0 and loss > 3', () => {
    expect(mosVerdict(3.9, 10, 3.1)).toBe('Elevated packet loss degraded audio quality.');
  });

  it('returns jitter verdict when mos < 4.0 and loss <= 3 and jitter > 50', () => {
    expect(mosVerdict(3.9, 51, 3)).toBe('High jitter caused audio instability.');
  });

  it('returns acceptable verdict when mos >= 3.0 and no prior condition matches', () => {
    expect(mosVerdict(3.2, 40, 2)).toBe('Call quality was acceptable with minor issues.');
  });

  it('returns poor verdict otherwise', () => {
    expect(mosVerdict(2.5, 40, 2)).toBe('Call quality was poor — check network path and codec.');
  });
});
