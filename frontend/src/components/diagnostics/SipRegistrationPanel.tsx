import { LiveDot } from '../LiveDot';
import { formatDateTime } from '../../lib/time';
import type { RegistrationExtensionItem, RegistrationHealthResponse, RegistrationTrunkItem } from '../../types';
import styles from './SipRegistrationPanel.module.css';

interface SipRegistrationPanelProps {
  items: RegistrationHealthResponse;
  loading: boolean;
  onRefresh: () => void;
}

function StatusBadge({ status }: { status: 'registered' | 'unregistered' | 'unknown' }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{status}</span>;
}

function formatExpires(value: number | null): string {
  if (value === null || value <= 0) {
    return 'expired';
  }
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function expiresClass(value: number | null): string {
  if (value === null || value <= 0) {
    return styles.expiresExpired;
  }
  if (value <= 300) {
    return styles.expiresWarning;
  }
  return styles.expiresHealthy;
}

function ExtensionRows({ items, loading }: { items: RegistrationExtensionItem[]; loading: boolean }) {
  if (loading && items.length === 0) {
    return <tr><td colSpan={6} className={styles.emptyState}>Loading registrations…</td></tr>;
  }
  if (items.length === 0) {
    return <tr><td colSpan={6} className={styles.emptyState}>No registrations found</td></tr>;
  }
  return (
    <>
      {items.map((item) => (
        <tr key={item.extension}>
          <td className={styles.dataCell}>{item.extension}</td>
          <td className={styles.nameCell}>{item.displayName}</td>
          <td><StatusBadge status={item.status} /></td>
          <td className={styles.dataCell}>{item.registeredIp ?? '—'}</td>
          <td className={styles.dataCell}>{item.lastSeen ? formatDateTime(item.lastSeen) : '—'}</td>
          <td className={`${styles.dataCell} ${expiresClass(item.expiresIn)}`}>{formatExpires(item.expiresIn)}</td>
        </tr>
      ))}
    </>
  );
}

function TrunkRows({ items, loading }: { items: RegistrationTrunkItem[]; loading: boolean }) {
  if (loading && items.length === 0) {
    return <tr><td colSpan={5} className={styles.emptyState}>Loading registrations…</td></tr>;
  }
  if (items.length === 0) {
    return <tr><td colSpan={5} className={styles.emptyState}>No registrations found</td></tr>;
  }
  return (
    <>
      {items.map((item) => (
        <tr key={item.trunkName}>
          <td className={styles.nameCell}>{item.trunkName}</td>
          <td className={styles.dataCell}>{item.host || '—'}</td>
          <td><StatusBadge status={item.status} /></td>
          <td className={styles.dataCell}>{item.lastRegistration ? formatDateTime(item.lastRegistration) : '—'}</td>
          <td className={`${styles.dataCell} ${expiresClass(item.expiresIn)}`}>{formatExpires(item.expiresIn)}</td>
        </tr>
      ))}
    </>
  );
}

export function SipRegistrationPanel({ items, loading, onRefresh }: SipRegistrationPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Registration Health</h2>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.liveMeta}><LiveDot active />auto-refresh 30s</span>
          <button className={styles.refreshButton} onClick={onRefresh} type="button">Refresh Now</button>
        </div>
      </div>

      <div className={styles.sectionLabel}>Extensions</div>
      <div className={styles.tableCard}>
        <table>
          <thead>
            <tr>
              <th>Extension</th>
              <th>Display Name</th>
              <th>Status</th>
              <th>Registered IP</th>
              <th>Last Seen</th>
              <th>Expires In</th>
            </tr>
          </thead>
          <tbody>
            <ExtensionRows items={items.extensions} loading={loading} />
          </tbody>
        </table>
      </div>

      <div className={styles.sectionLabel}>SIP Trunks</div>
      <div className={styles.tableCard}>
        <table>
          <thead>
            <tr>
              <th>Trunk Name</th>
              <th>Host</th>
              <th>Status</th>
              <th>Last Registration</th>
              <th>Expires In</th>
            </tr>
          </thead>
          <tbody>
            <TrunkRows items={items.trunks} loading={loading} />
          </tbody>
        </table>
      </div>
    </section>
  );
}
