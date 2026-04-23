import styles from './ErrorMessage.module.css';

interface ErrorMessageProps {
  message: string | null;
  variant?: 'error' | 'info';
}

export function ErrorMessage({ message, variant = 'error' }: ErrorMessageProps) {
  if (!message) return null;
  return <div className={`${styles.error} ${variant === 'info' ? styles.info : ''}`.trim()}>{message}</div>;
}
