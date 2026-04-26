export type LogEventName =
  | 'StasisStart'
  | 'StasisEnd'
  | 'BridgeCreated'
  | 'BridgeDestroyed'
  | 'ChannelEnteredBridge'
  | 'ChannelLeftBridge'
  | 'ChannelDestroyed'
  | 'NodeExec'
  | string;

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'function') {
      continue;
    }
    output[key] = serializeValue(item);
  }
  return output;
}

export function logEvent(event: LogEventName, data: Record<string, unknown> = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...serializeValue(data) as Record<string, unknown>,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function stringifyArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(serializeValue(value));
  } catch {
    return String(value);
  }
}

function logCompat(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const [first, ...rest] = args;
  logEvent('Log', {
    level,
    message: stringifyArg(first),
    details: rest.map((item) => serializeValue(item)),
  });
}

export const stasisLogger = {
  log: (...args: unknown[]) => logCompat('info', args),
  warn: (...args: unknown[]) => logCompat('warn', args),
  error: (...args: unknown[]) => logCompat('error', args),
};
