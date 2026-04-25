import { ReactNode } from 'react';
import styles from './PageLayout.module.css';

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export function PageLayout({ title, subtitle, actions, children }: PageLayoutProps) {
  if (!children) {
    return (
      <div>
        {subtitle && <div className={styles.sectionLabel}>{subtitle}</div>}
        <h1 className={styles.title}>{title}</h1>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          {subtitle && <div className={styles.sectionLabel}>{subtitle}</div>}
          <h1 className={styles.title}>{title}</h1>
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}