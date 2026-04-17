import styles from './skeleton.module.css';

interface SkeletonTextProps {
  width?: string;
}

export function SkeletonText({ width = '60%' }: SkeletonTextProps) {
  return <div className={styles.text} data-testid="skeleton-text" style={{ width }} />;
}
