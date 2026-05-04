import { SkeletonRow } from './SkeletonRow';
import styles from './skeleton.module.css';

interface SkeletonTableProps {
  rows?: number;
  columns: Array<{ width: string | number }>;
}

export function SkeletonTable({ rows = 3, columns }: SkeletonTableProps) {
  return (
    <div className={styles.table} data-testid="skeleton-table">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonRow key={index} columns={columns} />
      ))}
    </div>
  );
}
