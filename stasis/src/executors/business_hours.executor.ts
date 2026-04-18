import { FlowNode } from '../flowLoader';

interface BusinessHoursDayConfig {
  enabled?: boolean;
  open?: string;
  close?: string;
}

interface BusinessHoursConfig {
  timezone?: string;
  schedule?: Record<string, BusinessHoursDayConfig>;
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function toMinutes(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function resolveNowParts(timezone: string, now: Date): { weekday: string; hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const weekday = String(parts.find((part) => part.type === 'weekday')?.value || '').toLowerCase();
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || '');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || '');

    if (!DAY_KEYS.includes(weekday) || !Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }

    return { weekday, hour, minute };
  } catch {
    return null;
  }
}

export function evaluateBusinessHours(config: BusinessHoursConfig, now = new Date()): 'open' | 'closed' {
  const timezone = String(config.timezone || '').trim();
  const schedule = config.schedule || {};
  if (!timezone) {
    return 'closed';
  }

  const nowParts = resolveNowParts(timezone, now);
  if (!nowParts) {
    return 'closed';
  }

  const dayConfig = schedule[nowParts.weekday] || {};
  if (!dayConfig.enabled) {
    return 'closed';
  }

  const openMinutes = toMinutes(String(dayConfig.open || ''));
  const closeMinutes = toMinutes(String(dayConfig.close || ''));
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
    return 'closed';
  }

  const currentMinutes = nowParts.hour * 60 + nowParts.minute;
  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes ? 'open' : 'closed';
}

export async function executeBusinessHours(node: FlowNode): Promise<'open' | 'closed'> {
  return evaluateBusinessHours((node.config || {}) as BusinessHoursConfig);
}
