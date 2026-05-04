import { ReactNode } from 'react';
import styles from './PageLayout.module.css';

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  backAction?: ReactNode;
  children?: ReactNode;
}

export function PageLayout({ title, subtitle, actions, backAction, children }: PageLayoutProps) {
  if (!children) {
    return (
      <div className={styles.headerLeft}>
        {backAction && <div>{backAction}</div>}
        <div>
          {subtitle && <div className={styles.sectionLabel}>{subtitle}</div>}
          <h1 className={styles.title}>{title}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {backAction && <div>{backAction}</div>}
          <div>
            {subtitle && <div className={styles.sectionLabel}>{subtitle}</div>}
            <h1 className={styles.title}>{title}</h1>
          </div>
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
}