import { formatDateTime } from '../../lib/time';
import { Loading } from '../common/Loading';
import type { SipRegistrationItem } from '../../types';
import styles from './SipRegistrationPanel.module.css';

interface SipRegistrationPanelProps {
  items: SipRegistrationItem[];
  loading: boolean;
}

export function SipRegistrationPanel({ items, loading }: SipRegistrationPanelProps) {
  if (loading && items.length === 0) {
    return <Loading message="Loading SIP registrations..." />;
  }

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
        {items.map((item) => (
          <div className={styles.row} key={item.name}>
            <span className={styles.mono}>{item.name}</span>
            <span>{item.type}</span>
            <span className={`${styles.badge} ${styles[item.status]}`}>{item.status}</span>
            <span className={styles.mono}>{item.contactUri || '—'}</span>
            <span className={styles.mono}>{item.rttMs ?? '—'}</span>
            <span>{item.lastSeen ? formatDateTime(item.lastSeen) : '—'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
