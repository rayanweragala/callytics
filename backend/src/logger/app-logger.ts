import { LoggerService } from '@nestjs/common';

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

function serializeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n')[0] || value.message,
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

function messageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(serializeValue(value));
  } catch {
    return String(value);
  }
}

function stackFirstLine(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.split('\n')[0];
  }
  if (value instanceof Error) {
    return value.stack?.split('\n')[0] || value.message;
  }
  return undefined;
}

export class AppLogger implements LoggerService {
  constructor(private readonly context?: string) {}

  static event(event: string, data: Record<string, unknown> = {}): void {
    process.stdout.write(`${JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...serializeValue(data) as Record<string, unknown>,
    })}\n`);
  }

  static dbQuery(operation: string, table: string, startedAt: number): void {
    AppLogger.event('DbQuery', {
      operation,
      table,
      durationMs: Date.now() - startedAt,
    });
  }

  static redisPublish(channel: string, payload: Record<string, unknown>): void {
    AppLogger.event('RedisPublish', { channel, payload });
  }

  static redisConsume(channel: string, payload: Record<string, unknown>): void {
    AppLogger.event('RedisConsume', { channel, payload });
  }

  static errorEvent(context: string, error: unknown): void {
    AppLogger.event('Error', {
      context,
      message: messageText(error),
      stack: stackFirstLine(error),
    });
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    AppLogger.event('Error', {
      context: context || this.context || 'Application',
      message: messageText(message),
      stack: stackFirstLine(trace) || stackFirstLine(message),
    });
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  private write(level: LogLevel, message: unknown, context?: string): void {
    AppLogger.event('Log', {
      level,
      context: context || this.context || 'Application',
      message: messageText(message),
    });
  }
}
