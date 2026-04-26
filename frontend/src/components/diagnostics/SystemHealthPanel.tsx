import { Loading } from '../common/Loading';
import type { DiagnosticsSystemHealth } from '../../types';
import styles from './SystemHealthPanel.module.css';

interface SystemHealthPanelProps {
  health: DiagnosticsSystemHealth | null;
  loading: boolean;
}

function formatUptime(value: number | null): string {
  if (value === null) {
    return 'Unknown';
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function SystemHealthPanel({ health, loading }: SystemHealthPanelProps) {
  if (loading && !health) {
    return <Loading message="Checking system health..." />;
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>System Health</h2>
        </div>
        <div className={styles.meta}>{health ? `uptime ${formatUptime(health.asterisk.uptimeSeconds)}` : 'No data'}</div>
      </div>

      <div className={styles.grid}>
        {(health?.items || []).map((item) => (
          <div className={styles.card} key={item.label}>
            <div className={styles.label}>{item.label}</div>
            <span className={`${styles.badge} ${styles[item.state]}`}>{item.state}</span>
            <div className={styles.detail}>{item.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
