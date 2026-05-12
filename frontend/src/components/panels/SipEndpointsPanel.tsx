import { EndpointStatusRow } from '../EndpointStatusRow';
import { Loading } from '../common/Loading';
import type { SipEndpointStatus } from '../../types';
import styles from './SipEndpointsPanel.module.css';

interface SipEndpointsPanelProps {
  sipStatuses: SipEndpointStatus[];
  loading?: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function SipEndpointsPanel({ sipStatuses, loading, page, totalPages, onPageChange }: SipEndpointsPanelProps) {
  const showPagination = sipStatuses.length > 0 || totalPages > 1;
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>sip endpoints</div>
      </div>
      <div className={styles.panelBody}>
        {loading ? (
          <Loading />
        ) : (
          <div className={styles.endpointTable}>
            {sipStatuses.length === 0 ? <div className={styles.empty}>No extensions registered.</div> : sipStatuses.map((endpoint) => <EndpointStatusRow key={endpoint.endpoint} endpoint={endpoint} />)}
          </div>
        )}
      </div>
      {showPagination ? (
        <div className={styles.paginationFooter}>
          <button className={styles.paginationButton} disabled={page <= 0} onClick={() => onPageChange(Math.max(0, page - 1))} type="button" aria-label="Go to previous page">
            ← Newer
          </button>
          <div className={styles.pageIndicator}>{page + 1} / {totalPages}</div>
          <button className={styles.paginationButton} disabled={page >= totalPages - 1} onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))} type="button" aria-label="Go to next page">
            Older →
          </button>
        </div>
      ) : null}
    </section>
  );
}
