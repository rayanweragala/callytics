import styles from './LiveDot.module.css';

interface LiveDotProps {
  active?: boolean;
}

export function LiveDot({ active = false }: LiveDotProps) {
  return <span className={active ? styles.active : styles.inactive} aria-hidden="true" />;
}
