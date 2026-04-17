import styles from './skeleton.module.css';

interface SkeletonCellProps {
  width?: string | number;
}

export function SkeletonCell({ width = '100%' }: SkeletonCellProps) {
  return <div className={styles.cell} style={{ width }} />;
}
