import { LiveDot } from './LiveDot';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  state: 'registered' | 'unregistered' | 'unknown';
}

export function StatusBadge({ state }: StatusBadgeProps) {
  const className =
    state === 'registered'
      ? styles.registered
      : state === 'unregistered'
        ? styles.unregistered
        : styles.unknown;

  return (
    <span className={`${styles.badge} ${className}`}>
      <LiveDot active={state === 'registered'} />
      {state}
    </span>
  );
}
