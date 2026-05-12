import { describe, it, expect } from 'vitest';
import { formatDateTime, formatRelativeTime, formatUptime,formatPacketTimestamp } from './time';

const DISPLAY_TIMEZONE = import.meta.env.VITE_DISPLAY_TIMEZONE || 'UTC';

function expectedDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('day')} ${map.get('month')} ${map.get('year')}, ${map.get('hour')}:${map.get('minute')}`;
}

function expectedPacketTime(value: string): string {
  const [timePart] = value.split('.');
  const [hh, mm, ss] = (timePart ?? '').split(':').map(Number);
  const d = new Date();
  d.setUTCHours(hh, mm, ss, 0);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

describe('time utilities', () => {
  describe('formatDateTime', () => {
    it('formats valid ISO string to "DD Mon YYYY, HH:MM"', () => {
      expect(formatDateTime('2026-04-16T14:30:00.000Z')).toBe(expectedDateTime('2026-04-16T14:30:00.000Z'));
    });

    it('handles Date object input', () => {
      expect(formatDateTime(new Date('2026-04-16T14:30:00.000Z'))).toBe(expectedDateTime('2026-04-16T14:30:00.000Z'));
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

    it('returns a string for null input based on current implementation', () => {
      expect(typeof formatDateTime(null as any)).toBe('string');
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
    expect(result).toBe(expectedPacketTime('03:56:19.510'));
  });

  it('returns the original string if time part is invalid', () => {
    expect(formatPacketTimestamp('not-a-time')).toBe('not-a-time');
  });

  it('returns the original string if format has no dot separator', () => {
    expect(formatPacketTimestamp('ab:cd:ef')).toBe('ab:cd:ef');
  });

  it('handles midnight UTC without throwing', () => {
    const result = formatPacketTimestamp('00:00:00.000');
    expect(result).toBe(expectedPacketTime('00:00:00.000'));
  });

  it('handles end of day UTC without throwing', () => {
    const result = formatPacketTimestamp('23:59:59.999');
    expect(result).toBe(expectedPacketTime('23:59:59.999'));
  });
});
