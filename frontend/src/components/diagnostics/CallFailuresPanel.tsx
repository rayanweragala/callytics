import { Pagination } from '../common/Pagination';
import { formatDateTime } from '../../lib/time';
import type { DiagnosticsFailureItem } from '../../types';
import styles from './CallFailuresPanel.module.css';
import { SkeletonRow } from '../common/skeleton';

interface CallFailuresPanelProps {
  items: DiagnosticsFailureItem[];
  loading?: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onTraceOpen?: (callId: string) => void;
  onFailureClick?: (item: DiagnosticsFailureItem) => void;
}

export function CallFailuresPanel({ items, loading = false, page, totalPages, onPageChange, onTraceOpen, onFailureClick }: CallFailuresPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Recent Call Failures</h2>
        </div>
      </div>

      <div className={styles.table}>
        <div className={styles.head}>
          <span>Time</span>
          <span>Caller ID</span>
          <span>Flow</span>
          <span>Failed Node</span>
          <span>Error</span>
          <span>Duration</span>
          <span>Trace</span>
        </div>

        {loading ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '15%' },
                { width: '15%' },
                { width: '20%' },
                { width: '15%' },
                { width: '25%' },
                { width: '10%' },
                { width: '5%' },
              ]} />
            ))}
          </>
        ) : items.length === 0 ? (
          <div className={styles.emptyState}>No call failures recorded.</div>
        ) : (
          items.map((item) => (
            <div className={styles.row} key={item.id} onClick={() => onFailureClick?.(item)} role="button" tabIndex={0} onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onFailureClick?.(item);
              }
            }}>
              <span>{formatDateTime(item.time)}</span>
              <span className={styles.mono}>{item.callerId || '—'}</span>
              <span>{item.flowName || 'Unknown flow'}</span>
              <span className={styles.mono}>{item.failedNodeType || '—'}</span>
              <span>{item.errorMessage || 'Unknown failure'}</span>
              <span className={styles.mono}>{item.durationSeconds ?? '—'}</span>
              <button className={styles.traceButton} onClick={(event) => {
                event.stopPropagation();
                onTraceOpen?.(item.callUuid || item.callId);
              }} type="button">{'>'}</button>
            </div>
          ))
        )}
      </div>

      <div className={styles.pagination}>
        <Pagination onPageChange={onPageChange} page={page} totalPages={totalPages} />
      </div>
    </section>
  );
}
