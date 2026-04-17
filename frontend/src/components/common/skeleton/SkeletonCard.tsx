import styles from './skeleton.module.css';

interface SkeletonCardProps {
  width?: string;
}

export function SkeletonCard({ width = '100%' }: SkeletonCardProps) {
  return <div className={styles.card} data-testid="skeleton-card" style={{ width }} />;
}
