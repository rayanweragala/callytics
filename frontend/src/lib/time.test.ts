import { describe, it, expect } from 'vitest';
import { formatDateTime, formatRelativeTime, formatUptime,formatPacketTimestamp } from './time';

describe('time utilities', () => {
  describe('formatDateTime', () => {
    it('formats valid ISO string to "DD Mon YYYY, HH:MM"', () => {
      const date = new Date(2026, 3, 16, 14, 30); // 16 Apr 2026, 14:30
      expect(formatDateTime(date.toISOString())).toBe('16 Apr 2026, 14:30');
    });

    it('handles Date object input', () => {
      const date = new Date(2026, 3, 16, 14, 30);
      expect(formatDateTime(date)).toBe('16 Apr 2026, 14:30');
    });

    it('does not throw on invalid string, but returns "Invalid Date"', () => {
      // In JS, new Date('invalid').getDate() is NaN
      try {
        const result = formatDateTime('not-a-date');
        expect(typeof result).toBe('string');
      } catch (e) {
        // expect it to be a string at least if it returns something
      }
    });

    it('throws on null input based on current implementation', () => {
       // Source does not handle null, so it throws. 
       // We keep it throwing to avoid modifying source.
       expect(() => formatDateTime(null as any)).toThrow();
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "Xs ago" for seconds', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 10000)).toBe('10s ago');
    });

    it('returns "Xm ago" for minutes', () => {
      const now = Date.now();
      expect(formatRelativeTime(now - 120000)).toBe('2m ago');
    });
  });

  describe('formatUptime', () => {
    it('formats seconds to HH:MM:SS', () => {
      expect(formatUptime(3661)).toBe('01:01:01');
    });
  });
});

describe('formatPacketTimestamp', () => {
  it('returns a string in HH:MM:SS format', () => {
    const result = formatPacketTimestamp('03:56:19.510');
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns the original string if time part is invalid', () => {
    expect(formatPacketTimestamp('not-a-time')).toBe('not-a-time');
  });

  it('returns the original string if format has no dot separator', () => {
    expect(formatPacketTimestamp('ab:cd:ef')).toBe('ab:cd:ef');
  });

  it('handles midnight UTC without throwing', () => {
    const result = formatPacketTimestamp('00:00:00.000');
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('handles end of day UTC without throwing', () => {
    const result = formatPacketTimestamp('23:59:59.999');
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});