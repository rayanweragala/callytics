import { formatDateTime } from '../../lib/time';
import type { SipRegistrationItem } from '../../types';
import styles from './SipRegistrationPanel.module.css';

interface SipRegistrationPanelProps {
  items: SipRegistrationItem[];
  loading: boolean;
}

export function SipRegistrationPanel({ items, loading }: SipRegistrationPanelProps) {

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Panel C</div>
          <h2 className={styles.title}>SIP Registration Status</h2>
        </div>
      </div>

      <div className={styles.table}>
        <div className={styles.head}>
          <span>Name</span>
          <span>Type</span>
          <span>Status</span>
          <span>Contact URI</span>
          <span>RTT</span>
          <span>Last Seen</span>
        </div>
        {loading && items.length === 0 ? (
          <div className={styles.empty}>Loading SIP registrations…</div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>No SIP registrations found.</div>
        ) : (
          items.map((item) => (
            <div className={styles.row} key={item.name}>
              <span className={`${styles.mono} ${styles.cell} ${styles.nameCell}`} title={item.name}>{item.name}</span>
              <span className={`${styles.cell} ${styles.typeCell}`}>{item.type}</span>
              <span className={styles.cell}>
                <span className={`${styles.badge} ${styles[item.status]}`}>{item.status}</span>
              </span>
              <span className={`${styles.mono} ${styles.cell} ${styles.contactCell}`} title={item.contactUri || '—'}>{item.contactUri || '—'}</span>
              <span className={`${styles.mono} ${styles.cell}`}>{item.rttMs ?? '—'}</span>
              <span className={`${styles.cell} ${styles.lastSeenCell}`}>{item.lastSeen ? formatDateTime(item.lastSeen) : '—'}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
