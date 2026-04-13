import { formatUptime } from '../lib/time';
import styles from './StatBar.module.css';

interface StatBarProps {
  metrics: {
    activeCalls: number;
    registeredEndpoints: number;
    flows: number;
    uptimeSeconds: number;
  };
}

export function StatBar({ metrics }: StatBarProps) {
  const cells = [
    { label: 'ACTIVE CALLS', value: String(metrics.activeCalls) },
    { label: 'REGISTERED ENDPOINTS', value: String(metrics.registeredEndpoints) },
    { label: 'FLOWS', value: String(metrics.flows) },
    { label: 'UPTIME', value: formatUptime(metrics.uptimeSeconds) },
  ];

  return (
    <section className={styles.grid}>
      {cells.map((cell) => (
        <div className={styles.cell} key={cell.label}>
          <div className={styles.value}>{cell.value}</div>
          <div className={styles.label}>{cell.label}</div>
        </div>
      ))}
    </section>
  );
}
