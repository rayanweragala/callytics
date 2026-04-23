import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage } from '../../components/common/ErrorMessage';
import { Loading } from '../../components/common/Loading';
import { PageLayout } from '../../components/common/PageLayout';
import { Pagination } from '../../components/common/Pagination';
import { listAsteriskLogs } from '../../lib/api';
import { getApiError } from '../../lib/apiError';
import { formatDateTime } from '../../lib/time';
import type { AsteriskLogEntry, AsteriskLogLevel } from '../../types';
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

export function AsteriskLogsPage() {
  const [level, setLevel] = useState<LevelFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [entries, setEntries] = useState<AsteriskLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [fileExists, setFileExists] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

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
  }, [level, search, offset, refreshKey]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const emptyText = useMemo(() => {
    if (!fileExists) {
      return 'No Asterisk log file found. Asterisk may not have written any logs yet.';
    }
    return 'No log entries match the current filter.';
  }, [fileExists]);

  return (
    <PageLayout title="Asterisk Logs" subtitle="monitor">
      <div className={styles.page}>
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
          <div className={styles.tableHead}>
            <div>timestamp</div>
            <div>level</div>
            <div>module</div>
            <div>message</div>
          </div>

          {loading ? <Loading message="Loading logs..." /> : null}
          {!loading && errorText ? <ErrorMessage message={errorText} /> : null}

          {!loading && !errorText && entries.length === 0 ? (
            <div className={styles.empty}>{emptyText}</div>
          ) : null}

          {!loading && !errorText && entries.map((entry, index) => (
            <div className={styles.row} key={`${entry.timestamp}-${entry.module}-${index}`}>
              <div className={styles.timestamp}>{formatDateTime(entry.timestamp)}</div>
              <div>
                <span className={`${styles.levelBadge} ${levelBadgeClass(entry.level)}`.trim()}>{entry.level}</span>
              </div>
              <div className={styles.module} title={entry.module}>{entry.module}</div>
              <div className={styles.messageCell}>
                <span className={styles.rawMessage}>{entry.message}</span>
                {entry.translation ? <span className={styles.translation}>{entry.translation}</span> : null}
              </div>
            </div>
          ))}

          <Pagination page={page} totalPages={totalPages} onPageChange={(nextPage) => setOffset((nextPage - 1) * PAGE_SIZE)} />
        </div>
      </div>
    </PageLayout>
  );
}
