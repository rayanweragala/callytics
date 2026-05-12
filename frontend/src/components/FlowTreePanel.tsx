import { useMemo, useState } from 'react';
import type { FlowTree, FlowTreeChild } from '../types';
import styles from './FlowTreePanel.module.css';

interface FlowTreePanelProps {
  tree: FlowTree | null;
  currentFlowId: number;
  onNavigate: (flowId: number) => void;
  onRename?: (flowId: number, name: string) => void | Promise<void>;
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
  onRename,
}: {
  child: FlowTreeChild;
  currentFlowId: number;
  depth: number;
  onNavigate: (flowId: number) => void;
  onRename?: (flowId: number, name: string) => void | Promise<void>;
}) {
  const isActive = child.subflowId === currentFlowId;
  const depthClass = styles[`depth${Math.min(depth, 10)}` as keyof typeof styles] || '';
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(child.name);

  const submitRename = async () => {
    const nextName = draftName.trim();
    if (!nextName || nextName === child.name) {
      setDraftName(child.name);
      setIsRenaming(false);
      return;
    }
    await onRename?.(child.subflowId, nextName);
    setIsRenaming(false);
  };

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
          <span className={styles.itemMetaRow}>
            {child.branchKey ? <span className={styles.branchMeta}>branch {child.branchKey}</span> : null}
            {isRenaming ? (
              <input
                autoFocus
                className={styles.renameInput}
                onBlur={() => void submitRename()}
                onChange={(event) => setDraftName(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitRename();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setDraftName(child.name);
                    setIsRenaming(false);
                  }
                }}
                value={draftName}
              />
            ) : (
              <>
                <span className={styles.itemMeta}>{child.name}</span>
                {onRename ? (
                  <span
                    className={styles.renameButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDraftName(child.name);
                      setIsRenaming(true);
                    }}
                    role="button"
                    tabIndex={0}
                    title="Rename submenu"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraftName(child.name);
                        setIsRenaming(true);
                      }
                    }}
                  >
                    ✎
                  </span>
                ) : null}
              </>
            )}
          </span>
        </span>
      </button>
      {child.children.length > 0 ? (
        <div className={styles.children} data-testid="tree-child-entry">
          {child.children.map((grandchild) => (
            <TreeItem
              child={grandchild}
              currentFlowId={currentFlowId}
              depth={depth + 1}
              key={`${grandchild.subflowId}-${grandchild.nodeKey}`}
              onNavigate={onNavigate}
              onRename={onRename}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FlowTreePanel({ tree, currentFlowId, onNavigate, onRename }: FlowTreePanelProps) {
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
                    onRename={onRename}
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
