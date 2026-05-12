import type { FlowBreadcrumbItem } from '../types';
import styles from './FlowBreadcrumb.module.css';

interface FlowBreadcrumbProps {
  items: FlowBreadcrumbItem[];
  onNavigate: (flowId: number) => void;
}

export function FlowBreadcrumb({ items, onNavigate }: FlowBreadcrumbProps) {
  if (items.length <= 1) {
    return null;
  }

  return (
    <nav className={styles.breadcrumb} aria-label="Flow breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        const branchContext = item.parentBranchKey
          ? `${item.parentNodeLabel || item.parentNodeKey || 'Menu'} / ${item.parentBranchKey}`
          : null;
        return (
          <div className={styles.item} key={`${item.flowId}-${index}`}>
            {isLast ? (
              <span className={styles.current}>
                {item.flowName}
                {branchContext ? <span className={styles.context}> · {branchContext}</span> : null}
              </span>
            ) : (
              <button className={styles.link} onClick={() => onNavigate(item.flowId)} type="button">
                {item.flowName}
                {branchContext ? <span className={styles.context}> · {branchContext}</span> : null}
              </button>
            )}
            {!isLast ? <span className={styles.separator}>{'>'}</span> : null}
          </div>
        );
      })}
    </nav>
  );
}
