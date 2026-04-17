import { useEffect, useState } from 'react';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { SkeletonRow } from '../components/common/skeleton';
import { getDiagnosticsFailures } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { diagnosticsSocket } from '../lib/socket';
import type { DiagnosticsFailureItem, CallEvent } from '../types';
import styles from './CallLogsPage.module.css';

const PAGE_SIZE = 20;

interface CallLogItem extends DiagnosticsFailureItem {
  isLive?: boolean;
}

export function CallLogsPage() {
  const [failures, setFailures] = useState<CallLogItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<CallLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Load historical failures from REST API
  const fetchFailures = async (pageNum: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const offset = (pageNum - 1) * PAGE_SIZE;
      const response = await getDiagnosticsFailures(PAGE_SIZE, offset);
      setFailures(response.data);
      setTotal(response.total);
    } catch (err) {
      setError(getApiError(err, 'failed to load call failures'));
    } finally {
      setLoading(false);
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  };

  // Initial load
  useEffect(() => {
    void fetchFailures(page);
  }, [page]);

  // Real-time call event subscription
  useEffect(() => {
    const handleCallEvent = (event: CallEvent) => {
      const item: CallLogItem = {
        id: Math.random(),
        callId: event.callId,
        time: event.timestamp,
        callerId: event.caller || null,
        flowName: null,
        failedNodeType: event.type === 'failed' ? event.failedNode || null : null,
        errorMessage: event.type === 'failed' ? event.failureReason || null : null,
        durationSeconds: event.durationSeconds || null,
        isLive: true,
      };

      // Only show failed calls in live stream
      if (event.type === 'failed') {
        setLiveEvents((current) => [item, ...current].slice(0, 50));
      }
    };

    if (diagnosticsSocket.connected) {
      diagnosticsSocket.emit('call:subscribe');
    }

    diagnosticsSocket.on('connect', () => {
      diagnosticsSocket.emit('call:subscribe');
    });
    diagnosticsSocket.on('call:event', handleCallEvent);

    return () => {
      diagnosticsSocket.off('connect', () => {});
      diagnosticsSocket.off('call:event', handleCallEvent);
      diagnosticsSocket.emit('call:unsubscribe');
    };
  }, []);

  const allItems = [...liveEvents, ...failures];

  return (
    <PageLayout subtitle="call history & live events" title="Call Logs">
      <div className={styles.page}>
        <ErrorMessage message={error} />

        <section className={styles.panel}>
          <div className={styles.header}>
            <div>
              <h2 className={styles.title}>Recent Failures</h2>
              <p className={styles.subtitle}>Last {total} failed calls</p>
            </div>
          </div>

          {isLoading ? (
            <>
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonRow key={i} columns={[
                  { width: '15%' },
                  { width: '15%' },
                  { width: '20%' },
                  { width: '15%' },
                  { width: '20%' },
                ]} />
              ))}
            </>
          ) : error ? (
            <ErrorMessage message={error} />
          ) : allItems.length === 0 ? (
            <div className={styles.empty}>No call failures to display.</div>
          ) : (
            <div className="fadeIn">
              <div className={styles.table}>
                <div className={styles.head}>
                  <span>Time</span>
                  <span>Caller</span>
                  <span>Failed Node</span>
                  <span>Error</span>
                  <span>Duration</span>
                </div>
                {allItems.map((item) => (
                  <div
                    className={`${styles.row} ${item.isLive ? styles.live : ''}`}
                    key={`${item.callId}-${item.id}`}
                  >
                    <span className={styles.mono}>{new Date(item.time).toLocaleTimeString()}</span>
                    <span className={styles.mono}>{item.callerId || '—'}</span>
                    <span>{item.failedNodeType || '—'}</span>
                    <span>{item.errorMessage || 'Unknown'}</span>
                    <span className={styles.mono}>{item.durationSeconds ?? '—'}s</span>
                  </div>
                ))}
              </div>

              {failures.length > 0 && (
                <div className={styles.pagination}>
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    type="button"
                  >
                    ← Prev
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    type="button"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </PageLayout>
  );
}

