export function formatRelativeTime(ts: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return `${Math.floor(diffSeconds / 3600)}h ago`;
}

export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

/**
 * Formats a date-time value as "13 Apr 2026, 09:57"
 * Day-month-year, 24h time, no seconds.
 */
export function formatDateTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-GB', { month: 'short' });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}


/**
 * Converts a tshark UTC packet timestamp "HH:MM:SS.mmm" to local time "HH:MM:SS".
 * Tshark always emits UTC - this converts to the browser's local timezone
 */
export function formatPacketTimestamp(utcTime: string): string {
  const [timePart] = utcTime.split('.');
  const [hh, mm, ss] = (timePart ?? '').split(':').map(Number);
  if ([hh, mm, ss].some(Number.isNaN)) return utcTime;
  const d = new Date();
  d.setUTCHours(hh, mm, ss, 0);
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Formats a byte count as human-readable size.
 * Shows GB if value >= 1 GB, otherwise MB. One decimal place.
 */
export function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(1)} MB`;
}