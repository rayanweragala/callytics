import { useMemo, useState } from 'react';
import type { FlowTree, FlowTreeChild } from '../types';
import styles from './FlowTreePanel.module.css';

interface FlowTreePanelProps {
  tree: FlowTree | null;
  currentFlowId: number;
  onNavigate: (flowId: number) => void;
}

function MenuIcon() {
  return (
    <span className={styles.icon} aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <rect x="2" y="2" width="4" height="4" rx="1" />
        <rect x="10" y="2" width="4" height="4" rx="1" />
        <rect x="2" y="10" width="4" height="4" rx="1" />
        <rect x="10" y="10" width="4" height="4" rx="1" />
      </svg>
    </span>
  );
}

function TreeItem({
  child,
  currentFlowId,
  depth,
  onNavigate,
}: {
  child: FlowTreeChild;
  currentFlowId: number;
  depth: number;
  onNavigate: (flowId: number) => void;
}) {
  const isActive = child.subflowId === currentFlowId;
  const depthClass = styles[`depth${Math.min(depth, 10)}` as keyof typeof styles] || '';

  return (
    <div className={styles.branch}>
      <button
        className={`${styles.itemButton} ${depthClass} ${isActive ? styles.itemButtonActive : ''}`}
        onClick={() => onNavigate(child.subflowId)}
        type="button"
      >
        <span className={styles.itemIndicator} />
        <MenuIcon />
        <span className={styles.itemTextGroup}>
          <span className={styles.itemLabel}>{child.nodeLabel}</span>
          <span className={styles.itemMeta}>{child.name}</span>
        </span>
      </button>
      {child.children.length > 0 ? (
        <div className={styles.children}>
          {child.children.map((grandchild) => (
            <TreeItem
              child={grandchild}
              currentFlowId={currentFlowId}
              depth={depth + 1}
              key={`${grandchild.subflowId}-${grandchild.nodeKey}`}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FlowTreePanel({ tree, currentFlowId, onNavigate }: FlowTreePanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  const rootIsActive = useMemo(() => tree?.id === currentFlowId, [currentFlowId, tree?.id]);

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>Flow Tree</div>
        <button
          className={styles.toggleButton}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}>▾</span>
        </button>
      </div>

      {isOpen ? (
        <div className={styles.body}>
          {tree ? (
            <>
              <button
                className={`${styles.itemButton} ${rootIsActive ? styles.itemButtonActive : ''}`}
                onClick={() => onNavigate(tree.id)}
                type="button"
              >
                <span className={styles.itemIndicator} />
                <MenuIcon />
                <span className={styles.itemTextGroup}>
                  <span className={styles.itemLabel}>{tree.name}</span>
                  <span className={styles.itemMeta}>root flow</span>
                </span>
              </button>
              <div className={styles.children}>
                {tree.children.map((child) => (
                  <TreeItem
                    child={child}
                    currentFlowId={currentFlowId}
                    depth={1}
                    key={`${child.subflowId}-${child.nodeKey}`}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className={styles.empty}>No subflows yet.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}
