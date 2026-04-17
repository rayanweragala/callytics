import { Pagination } from '../common/Pagination';
import { formatDateTime } from '../../lib/time';
import type { DiagnosticsFailureItem } from '../../types';
import styles from './CallFailuresPanel.module.css';

interface CallFailuresPanelProps {
  items: DiagnosticsFailureItem[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function CallFailuresPanel({ items, page, totalPages, onPageChange }: CallFailuresPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Panel E</div>
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
        </div>
        {items.map((item) => (
          <div className={styles.row} key={item.id} style={{ cursor: 'default' }}>
            {/* TODO Phase 19+: row click will navigate to per-call execution timeline
            once CallLogsPage is implemented. Routing removed for now — target was a placeholder. */}
            <span>{formatDateTime(item.time)}</span>
            <span className={styles.mono}>{item.callerId || '—'}</span>
            <span>{item.flowName || 'Unknown flow'}</span>
            <span className={styles.mono}>{item.failedNodeType || '—'}</span>
            <span>{item.errorMessage || 'Unknown failure'}</span>
            <span className={styles.mono}>{item.durationSeconds ?? '—'}</span>
          </div>
        ))}
      </div>

      <div className={styles.pagination}>
        <Pagination onPageChange={onPageChange} page={page} totalPages={totalPages} />
      </div>
    </section>
  );
}
