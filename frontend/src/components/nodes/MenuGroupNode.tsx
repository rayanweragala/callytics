import { Handle, NodeProps, Position } from 'reactflow';
import type { FlowNodeData } from '../../types';
import styles from './MenuGroupNode.module.css';

const MENU_ROUTABLE_BRANCHES = /^(?:\d{1,2}|\*|#)$/;
const DEFAULT_BRANCHES = ['1', '2'];

function getActiveBranches(config: Record<string, unknown>): string[] {
  if (!Array.isArray(config.branches)) {
    return DEFAULT_BRANCHES;
  }

  const values = config.branches
    .map((value) => String(value || '').trim())
    .filter((value) => MENU_ROUTABLE_BRANCHES.test(value));

  return values.length > 0 ? values : DEFAULT_BRANCHES;
}

function branchLabel(branch: string): string {
  return branch;
}

export function MenuGroupNode({ data, selected }: NodeProps<FlowNodeData & { diffColor?: string }>) {
  const branches = getActiveBranches(data.config);
  const diffStyle = data.diffColor ? { borderColor: `var(${data.diffColor})`, boxShadow: `0 0 0 2px color-mix(in srgb, var(${data.diffColor}) 20%, transparent)` } : undefined;

  return (
    <div
      className={`${styles.node} ${selected ? styles.selected : ''} ${data.hasValidationError ? styles.invalid : ''}`}
      style={diffStyle}
    >
      {data.hasValidationError ? <span className={styles.validationDot} title={data.validationIssues?.join(', ')} /> : null}
      <span className={styles.accent} />
      <Handle className={styles.handle} type="target" position={Position.Left} />
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <rect x="2" y="2" width="4" height="4" rx="1" />
              <rect x="10" y="2" width="4" height="4" rx="1" />
              <rect x="2" y="10" width="4" height="4" rx="1" />
              <rect x="10" y="10" width="4" height="4" rx="1" />
            </svg>
          </span>
          <div>
            <div className={styles.type}>menu</div>
            <input
              className={styles.labelInput}
              value={data.label || 'Menu'}
              onChange={(event) => data.onLabelChange?.(event.target.value)}
              onBlur={() => data.onLabelSubmit?.()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  data.onLabelSubmit?.();
                }
              }}
            />
          </div>
        </div>

        <div className={styles.branchList}>
          {branches.map((branch) => (
            <div className={styles.branchRow} key={branch}>
              <span className={styles.branchLabel}>{branchLabel(branch)}</span>
              <Handle className={styles.branchHandle} id={branch} type="source" position={Position.Right} />
            </div>
          ))}
        </div>
      </div>
      {selected && data.onDelete ? (
        <button
          className={styles.deleteButton}
          onClick={(event) => {
            event.stopPropagation();
            data.onDelete?.();
          }}
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
