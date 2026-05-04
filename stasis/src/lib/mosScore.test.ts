import { computeMos, worseDirection } from './mosScore';

function findInputForRoundedMos(target: number): number {
  for (let jitter = 0; jitter <= 400; jitter += 0.01) {
    const result = computeMos({ jitter: Number(jitter.toFixed(2)), packetLoss: 0, rtt: 0 });
    if (result.mos === target) {
      return Number(jitter.toFixed(2));
    }
  }
  throw new Error(`Could not find jitter for target MOS ${target}`);
}

describe('computeMos', () => {
  it('zero jitter + zero loss yields MOS >= 4.0 and good grade', () => {
    const result = computeMos({ jitter: 0, packetLoss: 0, rtt: 0 });
    expect(result.mos).toBeGreaterThanOrEqual(4.0);
    expect(result.mos).toBeCloseTo(4.4, 1);
    expect(result.grade).toBe('good');
  });

  it('boundary MOS exactly at 4.0 yields good grade', () => {
    const jitter = findInputForRoundedMos(4.0);
    const result = computeMos({ jitter, packetLoss: 0, rtt: 0 });
    expect(result.mos).toBe(4.0);
    expect(result.grade).toBe('good');
  });

  it('boundary MOS just below 4.0 yields fair grade', () => {
    const jitter = findInputForRoundedMos(3.99);
    const result = computeMos({ jitter, packetLoss: 0, rtt: 0 });
    expect(result.mos).toBe(3.99);
    expect(result.grade).toBe('fair');
  });

  it('boundary MOS exactly at 3.0 yields fair grade', () => {
    const jitter = findInputForRoundedMos(3.0);
    const result = computeMos({ jitter, packetLoss: 0, rtt: 0 });
    expect(result.mos).toBe(3.0);
    expect(result.grade).toBe('fair');
  });

  it('boundary MOS just below 3.0 yields poor grade', () => {
    const jitter = findInputForRoundedMos(2.99);
    const result = computeMos({ jitter, packetLoss: 0, rtt: 0 });
    expect(result.mos).toBe(2.99);
    expect(result.grade).toBe('poor');
  });

  it('high jitter (80ms), zero loss yields fair or poor grade', () => {
    const result = computeMos({ jitter: 80, packetLoss: 0, rtt: 0 });
    expect(['fair', 'poor']).toContain(result.grade);
  });

  it('zero jitter with high loss yields poor grade', () => {
    const result = computeMos({ jitter: 0, packetLoss: 20, rtt: 0 });
    expect(result.grade).toBe('poor');
  });

  it('extreme values clamp MOS at 1.0 floor', () => {
    const result = computeMos({ jitter: 10000, packetLoss: 100, rtt: 10000 });
    expect(result.mos).toBe(1.0);
    expect(result.grade).toBe('poor');
  });

  it('very good values stay within 5.0 ceiling', () => {
    const result = computeMos({ jitter: -1000, packetLoss: -100, rtt: 0 });
    expect(result.mos).toBe(5.0);
    expect(result.grade).toBe('good');
  });
});

describe('worseDirection', () => {
  it('picks higher jitter from two directions', () => {
    const result = worseDirection(
      { jitter: 10, packetLoss: 2, rtt: 20 },
      { jitter: 25, packetLoss: 1, rtt: 10 },
    );

    expect(result.jitter).toBe(25);
  });

  it('picks higher packetLoss from two directions', () => {
    const result = worseDirection(
      { jitter: 10, packetLoss: 0.5, rtt: 20 },
      { jitter: 8, packetLoss: 3.5, rtt: 18 },
    );

    expect(result.packetLoss).toBe(3.5);
  });
});
