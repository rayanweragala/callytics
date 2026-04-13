import { formatRelativeTime } from '../lib/time';
import type { SipEndpointStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import styles from './EndpointStatusRow.module.css';

interface EndpointStatusRowProps {
  endpoint: SipEndpointStatus;
}

export function EndpointStatusRow({ endpoint }: EndpointStatusRowProps) {
  return (
    <div className={styles.row} title={endpoint.contacts.join(', ') || 'No active contacts'}>
      <div className={styles.name}>{endpoint.endpoint}</div>
      <div className={styles.address}>{endpoint.contacts[0] || '—'}</div>
      <StatusBadge state={endpoint.state} />
      <div className={styles.since} title={new Date(endpoint.updatedAt).toISOString()}>
        {formatRelativeTime(endpoint.updatedAt)}
      </div>
    </div>
  );
}
