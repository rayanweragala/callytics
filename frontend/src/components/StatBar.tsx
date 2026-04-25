import { formatUptime } from '../lib/time';
import styles from './StatBar.module.css';

interface StatBarProps {
  metrics?: {
    activeCalls: number;
    registeredEndpoints: number;
    flows: number;
    uptimeSeconds: number;
  };
  cells?: Array<{ label: string; value: string }>;
}

export function StatBar({ metrics, cells: customCells }: StatBarProps) {
  const cells = customCells || [
    { label: 'ACTIVE CALLS', value: String(metrics?.activeCalls ?? 0) },
    { label: 'REGISTERED ENDPOINTS', value: String(metrics?.registeredEndpoints ?? 0) },
    { label: 'FLOWS', value: String(metrics?.flows ?? 0) },
    { label: 'UPTIME', value: formatUptime(metrics?.uptimeSeconds ?? 0) },
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
