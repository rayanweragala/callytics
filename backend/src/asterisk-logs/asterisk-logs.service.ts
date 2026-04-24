import { Injectable } from '@nestjs/common';
import * as fs from 'fs';

type AsteriskLogLevel = 'ERROR' | 'WARNING' | 'NOTICE' | 'VERBOSE' | 'DEBUG' | 'UNKNOWN';

export interface AsteriskLogEntry {
  timestamp: string;
  level: AsteriskLogLevel;
  channel: string;
  module: string;
  raw: string;
  message: string;
  translation?: string;
}

interface TranslationRule {
  pattern: RegExp;
  translation: string;
}

const LOG_FILE_PATH = '/var/log/asterisk/messages';

const TRANSLATION_RULES: TranslationRule[] = [
  {
    pattern: /Registration from .+ failed/i,
    translation: 'SIP registration rejected — check trunk or extension credentials',
  },
  {
    pattern: /No matching endpoint/i,
    translation: 'Incoming call from an unknown SIP address — no matching extension or trunk',
  },
  {
    pattern: /Unable to create channel/i,
    translation: 'Failed to create a call channel — Asterisk may be overloaded or misconfigured',
  },
  {
    pattern: /connect\(\) failed/i,
    translation: 'Cannot reach SIP trunk — check network connectivity or firewall rules',
  },
  {
    pattern: /no response.*timeout|timeout.*no response/i,
    translation: 'SIP trunk not responding — check trunk reachability in the Trunks page',
  },
  {
    pattern: /codec.*not available|no codec/i,
    translation: 'Codec mismatch — the trunk or extension does not support the selected codec',
  },
  {
    pattern: /transport.*error|error.*transport/i,
    translation: 'SIP transport error — verify port 5080 is open and not in use',
  },
  {
    pattern: /Asterisk Ready/i,
    translation: 'Asterisk started successfully',
  },
  {
    pattern: /Out of memory|malloc failed/i,
    translation: 'Asterisk is out of memory — reduce load or increase host RAM',
  },
  {
    pattern: /authentication failed/i,
    translation: 'SIP authentication failed — wrong username or password',
  },
];

@Injectable()
export class AsteriskLogsService {
  getLogs(
    level = 'all',
    search = '',
    hideNoise = true,
    uniqueid = '',
    from = '',
    to = '',
    limit = 100,
    offset = 0,
  ): { entries: AsteriskLogEntry[]; total: number; fileExists: boolean } {
    if (!fs.existsSync(LOG_FILE_PATH)) {
      return { entries: [], total: 0, fileExists: false };
    }

    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const normalizedLevel = String(level || 'all').toUpperCase();
    const normalizedSearch = String(search || '').trim().toLowerCase();
    const normalizedUniqueId = String(uniqueid || '').trim().toLowerCase();
    const uniqueIdNeedles = this.buildUniqueIdNeedles(normalizedUniqueId);
    const noiseHidden = hideNoise === true;
    const fromTime = this.parseFilterTimestamp(from);
    const toTime = this.parseFilterTimestamp(to);

    const content = fs.readFileSync(LOG_FILE_PATH, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsedEntries = lines
      .map((line) => this.parseLine(line))
      .filter((entry): entry is AsteriskLogEntry => entry !== null);

    const filteredWithoutUniqueId = parsedEntries.filter((entry) => {
      if (normalizedLevel !== 'ALL' && entry.level !== normalizedLevel) {
        return false;
      }

      if (normalizedSearch.length > 0) {
        const messageMatch = entry.message.toLowerCase().includes(normalizedSearch);
        const moduleMatch = entry.module.toLowerCase().includes(normalizedSearch);
        if (!messageMatch && !moduleMatch) {
          return false;
        }
      }

      if (noiseHidden && this.isNoiseEntry(entry.module)) {
        return false;
      }

      const entryTime = Date.parse(entry.timestamp);
      if (!Number.isNaN(entryTime)) {
        if (fromTime !== null && entryTime < fromTime) {
          return false;
        }
        if (toTime !== null && entryTime > toTime) {
          return false;
        }
      }

      return true;
    });

    const filtered =
      uniqueIdNeedles.length > 0
        ? this.filterByUniqueIdWithCorrelation(filteredWithoutUniqueId, uniqueIdNeedles)
        : filteredWithoutUniqueId;

    const mostRecentFirst = [...filtered].reverse();

    return {
      entries: mostRecentFirst.slice(safeOffset, safeOffset + safeLimit),
      total: mostRecentFirst.length,
      fileExists: true,
    };
  }

  private parseFilterTimestamp(value: string): number | null {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  private isNoiseEntry(moduleName: string): boolean {
    const normalized = moduleName.trim().toLowerCase();
    return normalized === 'manager.c' || normalized === 'res_pjsip_logger.c';
  }

  private matchesUniqueId(entry: AsteriskLogEntry, uniqueIdNeedles: string[]): boolean {
    const searchable = `${entry.channel} ${entry.message} ${entry.raw}`.toLowerCase();
    return uniqueIdNeedles.some((needle) => searchable.includes(needle));
  }

  private filterByUniqueIdWithCorrelation(entries: AsteriskLogEntry[], uniqueIdNeedles: string[]): AsteriskLogEntry[] {
    const included = new Set<number>();
    const channels = new Set<string>();
    const bridgeIds = new Set<string>();

    entries.forEach((entry, index) => {
      if (this.matchesUniqueId(entry, uniqueIdNeedles)) {
        included.add(index);
        this.collectCorrelationTokens(entry, channels, bridgeIds);
      }
    });

    if (included.size === 0) {
      return [];
    }

    let changed = true;
    while (changed) {
      changed = false;
      entries.forEach((entry, index) => {
        if (included.has(index)) {
          return;
        }

        if (this.matchesCorrelationContext(entry, channels, bridgeIds)) {
          included.add(index);
          this.collectCorrelationTokens(entry, channels, bridgeIds);
          changed = true;
        }
      });
    }

    return entries.filter((_, index) => included.has(index));
  }

  private collectCorrelationTokens(entry: AsteriskLogEntry, channels: Set<string>, bridgeIds: Set<string>): void {
    const channelMatches = [...entry.raw.matchAll(/\[(C-[^\]]+)\]/gi)];
    channelMatches.forEach((match) => channels.add(match[1].toLowerCase()));

    const bridgeMatches = [...entry.raw.matchAll(/stasis-bridge <([^>]+)>/gi)];
    bridgeMatches.forEach((match) => bridgeIds.add(match[1].toLowerCase()));
  }

  private matchesCorrelationContext(entry: AsteriskLogEntry, channels: Set<string>, bridgeIds: Set<string>): boolean {
    const searchable = `${entry.channel} ${entry.message} ${entry.raw}`.toLowerCase();
    for (const channel of channels) {
      if (searchable.includes(channel)) {
        return true;
      }
    }

    for (const bridgeId of bridgeIds) {
      if (searchable.includes(bridgeId)) {
        return true;
      }
    }

    return false;
  }

  private buildUniqueIdNeedles(uniqueId: string): string[] {
    const normalized = String(uniqueId || '').trim().toLowerCase();
    if (!normalized) {
      return [];
    }

    const needles = new Set<string>([normalized]);
    const dotIndex = normalized.indexOf('.');
    if (dotIndex > 0) {
      const base = normalized.slice(0, dotIndex);
      if (/^\d+$/.test(base)) {
        needles.add(`${base}.`);
        needles.add(`${base}/`);
      }
    }

    return [...needles];
  }

  private parseLine(rawLine: string): AsteriskLogEntry | null {
    const match = rawLine.match(/^\[([^\]]+)\]\s+([A-Z]+)(\[[^\]]+\])?(\[[^\]]+\])?\s+([^:]+):\s*(.*)$/);
    if (!match) {
      return null;
    }

    const timestampRaw = match?.[1]?.trim() ?? '';
    const parsedDate = this.parseTimestamp(timestampRaw);

    const level = this.normalizeLevel(match?.[2]);
    const channel = match?.[4] ? match[4].trim() : match?.[3] ? match[3].trim() : '';
    const moduleName = match?.[5]?.trim() || 'unknown';
    const message = match?.[6]?.trim() || rawLine;

    const translationRule = TRANSLATION_RULES.find((rule) => rule.pattern.test(rawLine));

    return {
      timestamp: parsedDate,
      level,
      channel,
      module: moduleName,
      raw: rawLine,
      message,
      translation: translationRule?.translation,
    };
  }

  private parseTimestamp(timestampRaw: string): string {
    if (!timestampRaw) {
      return new Date(0).toISOString();
    }

    const noYearMatch = timestampRaw.match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})$/);
    if (noYearMatch) {
      const [, month, day, time] = noYearMatch;
      const currentYear = new Date().getFullYear();
      const parsedNoYear = new Date(`${currentYear} ${month} ${day} ${time}`);
      if (!Number.isNaN(parsedNoYear.getTime())) {
        return parsedNoYear.toISOString();
      }
    }

    const isoInput = timestampRaw.includes('T') ? timestampRaw : timestampRaw.replace(' ', 'T');
    const parsed = new Date(isoInput);

    if (Number.isNaN(parsed.getTime())) {
      return new Date(0).toISOString();
    }

    return parsed.toISOString();
  }

  private normalizeLevel(levelRaw?: string): AsteriskLogLevel {
    const value = (levelRaw || '').toUpperCase();
    if (value === 'ERROR' || value === 'WARNING' || value === 'NOTICE' || value === 'VERBOSE' || value === 'DEBUG') {
      return value;
    }
    return 'UNKNOWN';
  }
}
