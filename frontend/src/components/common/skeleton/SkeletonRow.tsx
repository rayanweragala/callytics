import { SkeletonCell } from './SkeletonCell';
import styles from './skeleton.module.css';

interface SkeletonRowProps {
  columns: Array<{ width: string | number }>;
}

export function SkeletonRow({ columns }: SkeletonRowProps) {
  return (
    <div className={styles.row} data-testid="skeleton-row">
      {columns.map((col, index) => (
        <SkeletonCell key={index} width={col.width} />
      ))}
    </div>
  );
}
