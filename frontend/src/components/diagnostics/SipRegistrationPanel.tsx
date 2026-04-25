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

      <div className={styles.tableCard}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Contact URI</th>
              <th>RTT</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={6} className={styles.emptyState}>Loading SIP registrations…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className={styles.emptyState}>No SIP registrations found.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.name}>
                  <td className={`${styles.mono} ${styles.nameCell}`} title={item.name}>{item.name}</td>
                  <td className={styles.typeCell}>{item.type}</td>
                  <td>
                    <span className={`${styles.badge} ${styles[item.status]}`}>{item.status}</span>
                  </td>
                  <td className={`${styles.mono} ${styles.contactCell}`} title={item.contactUri || '—'}>{item.contactUri || '—'}</td>
                  <td className={styles.mono}>{item.rttMs ?? '—'}</td>
                  <td className={styles.lastSeenCell}>{item.lastSeen ? formatDateTime(item.lastSeen) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
