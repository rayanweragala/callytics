import styles from './MosGauge.module.css';

interface MosGaugeProps {
  label: string;
  value: number;
  unit: string;
  plainLabel: string;
  fillPct: number;
  grade: 'good' | 'fair' | 'poor';
}

function gradeClass(grade: 'good' | 'fair' | 'poor'): string {
  if (grade === 'good') return styles.good;
  if (grade === 'fair') return styles.fair;
  return styles.poor;
}

export function MosGauge({ label, value, unit, plainLabel, fillPct, grade }: MosGaugeProps) {
  const safeFill = Math.max(0, Math.min(100, fillPct));

  return (
    <div className={styles.gauge}>
      <div className={styles.row}>
        <span className={styles.label}>{label}</span>
        <span className={styles.valueWrap}>
          <span className={styles.value}>{value.toFixed(2)}{unit}</span>
          <span className={`${styles.plain} ${gradeClass(grade)}`}>{plainLabel}</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={`${styles.fill} ${gradeClass(grade)}`} style={{ ['--bar-width' as string]: `${safeFill}%` }} />
      </div>
    </div>
  );
}
