import styles from './Loading.module.css';

interface LoadingProps {
  message?: string;
}

export function Loading({ message = 'Loading...' }: LoadingProps) {
  return <div className={styles.loading}>{message}</div>;
}