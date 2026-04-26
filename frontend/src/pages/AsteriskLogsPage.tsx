import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { listAsteriskLogs } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { AsteriskLogEntry, AsteriskLogLevel } from '../types';
import styles from './AsteriskLogsPage.module.css';

type LevelFilter = 'all' | 'error' | 'warning' | 'notice' | 'verbose';

const PAGE_SIZE = 25;
const LEVEL_OPTIONS: Array<{ key: LevelFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Error' },
  { key: 'warning', label: 'Warning' },
  { key: 'notice', label: 'Notice' },
  { key: 'verbose', label: 'Verbose' },
];

function levelBadgeClass(level: AsteriskLogLevel): string {
  if (level === 'ERROR') return styles.levelError;
  if (level === 'WARNING') return styles.levelWarning;
  if (level === 'NOTICE') return styles.levelNotice;
  if (level === 'VERBOSE' || level === 'DEBUG') return styles.levelVerbose;
  return styles.levelUnknown;
}

function rowHighlightClass(level: AsteriskLogLevel): string {
  if (level === 'ERROR') return styles.rowError;
  if (level === 'WARNING') return styles.rowWarning;
  return '';
}

function normalizeChannel(value: string): string {
  return value.trim();
}

export function AsteriskLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [level, setLevel] = useState<LevelFilter>('all');
  const [hideNoise, setHideNoise] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [entries, setEntries] = useState<AsteriskLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [fileExists, setFileExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const uniqueidFilter = searchParams.get('uniqueid')?.trim() || '';
  const fromFilter = searchParams.get('from')?.trim() || '';
  const toFilter = searchParams.get('to')?.trim() || '';
  const callerNumberFilter = searchParams.get('callerNumber')?.trim() || '';
  const destinationFilter = searchParams.get('destination')?.trim() || '';
  const hasCallDrillDown = uniqueidFilter.length > 0 || fromFilter.length > 0 || toFilter.length > 0 || callerNumberFilter.length > 0 || destinationFilter.length > 0;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let active = true;

    const fetchLogs = async () => {
      setLoading(true);
      setErrorText(null);
      try {
        const response = await listAsteriskLogs({
          level,
          search,
          hideNoise,
          uniqueid: uniqueidFilter || undefined,
          from: fromFilter || undefined,
          to: toFilter || undefined,
          callerNumber: callerNumberFilter || undefined,
          destination: destinationFilter || undefined,
          limit: PAGE_SIZE,
          offset,
        });

        if (!active) return;

        setEntries(response.entries);
        setTotal(response.total);
        setFileExists(response.fileExists !== false);
      } catch (error) {
        if (!active) return;
        setErrorText(getApiError(error, 'failed to load asterisk logs'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchLogs();

    return () => {
      active = false;
    };
  }, [level, search, hideNoise, uniqueidFilter, fromFilter, toFilter, callerNumberFilter, destinationFilter, offset, refreshKey]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const emptyText = useMemo(() => {
    if (!fileExists) {
      return 'No Asterisk log file found. Asterisk may not have written any logs yet.';
    }
    return 'No log entries match the current filter.';
  }, [fileExists]);

  const channelGroupByValue = useMemo(() => {
    const map = new Map<string, string>();
    let useFirstGroup = true;

    for (const entry of entries) {
      const channel = normalizeChannel(entry.channel);
      if (!channel || map.has(channel)) {
        continue;
      }
      map.set(channel, useFirstGroup ? styles.channelGroupA : styles.channelGroupB);
      useFirstGroup = !useFirstGroup;
    }

    return map;
  }, [entries]);

  const clearDrillDownFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('uniqueid');
    next.delete('from');
    next.delete('to');
    next.delete('callerNumber');
    next.delete('destination');
    setSearchParams(next);
    setLevel('all');
    setSearchInput('');
    setSearch('');
    setOffset(0);
  };

  return (
    <PageLayout title="Asterisk Logs" subtitle="monitor">
      <div className={styles.page}>
        {hasCallDrillDown ? (
          <div className={styles.callFilterBanner}>
            <span>Showing logs for call {uniqueidFilter || 'unknown'}</span>
            <button type="button" className={styles.clearFilterLink} onClick={clearDrillDownFilter}>
              Clear filter
            </button>
          </div>
        ) : null}

        <div className={styles.header}>
          <div className={styles.levelFilters}>
            {LEVEL_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`${styles.levelPill} ${level === option.key ? styles.levelPillActive : ''}`.trim()}
                onClick={() => {
                  setLevel(option.key);
                  setOffset(0);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.levelPill} ${hideNoise ? styles.levelPillActive : ''}`.trim()}
              onClick={() => {
                setHideNoise((current) => !current);
                setOffset(0);
              }}
            >
              Hide noise
            </button>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search logs…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => setRefreshKey((current) => current + 1)}
              aria-label="Refresh logs"
              title="Refresh"
            >
              ↻
            </button>
          </div>
        </div>

        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>timestamp</th>
                <th>level</th>
                <th>channel</th>
                <th>module</th>
                <th>message</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className={styles.empty}><Loading message="Loading logs..." /></td>
                </tr>
              ) : null}
              {!loading && errorText ? (
                <tr>
                  <td colSpan={5} className={styles.empty}><ErrorMessage message={errorText} /></td>
                </tr>
              ) : null}
              {!loading && !errorText && entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>{emptyText}</td>
                </tr>
              ) : null}
              {!loading && !errorText && entries.map((entry, index) => {
                const normalizedChannel = normalizeChannel(entry.channel);
                const channelGroupClass = normalizedChannel ? channelGroupByValue.get(normalizedChannel) ?? '' : '';
                return (
                  <tr className={`${styles.row} ${channelGroupClass} ${rowHighlightClass(entry.level)}`.trim()} key={`${entry.timestamp}-${entry.module}-${index}`}>
                    <td className={styles.timestamp}>{formatDateTime(entry.timestamp)}</td>
                    <td>
                      <span className={`${styles.levelBadge} ${levelBadgeClass(entry.level)}`.trim()}>{entry.level}</span>
                    </td>
                    <td className={styles.channel} title={normalizedChannel || '—'}>{normalizedChannel || '—'}</td>
                    <td className={styles.module} title={entry.module}>{entry.module}</td>
                    <td className={styles.messageCell}>
                      <span className={styles.rawMessage}>{entry.message}</span>
                      {entry.translation ? <span className={styles.translation}>{entry.translation}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onPageChange={(nextPage) => setOffset((nextPage - 1) * PAGE_SIZE)} />
        </div>
      </div>
    </PageLayout>
  );
}
