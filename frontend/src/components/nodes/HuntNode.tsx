import { Handle, NodeProps, Position } from 'reactflow';
import type { FlowNodeData } from '../../types';
import styles from './HuntNode.module.css';

function destinationCount(config: Record<string, unknown>): number {
  if (!Array.isArray(config.destinations)) {
    return 0;
  }

  return config.destinations.filter((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return String(value || '').trim().length > 0;
    }
    const item = value as Record<string, unknown>;
    return String(item.target_value || '').trim().length > 0;
  }).length;
}

function strategyLabel(config: Record<string, unknown>): string {
  const raw = String(config.strategy || 'sequential').trim().toLowerCase();
  if (raw === 'group') return 'group';
  if (raw === 'random') return 'random';
  return 'sequential';
}

export function HuntNode({ data, selected }: NodeProps<FlowNodeData & { diffColor?: string }>) {
  const count = destinationCount(data.config);
  const strategy = strategyLabel(data.config);
  const diffStyle = data.diffColor ? { borderColor: `var(${data.diffColor})`, boxShadow: `0 0 0 2px color-mix(in srgb, var(${data.diffColor}) 20%, transparent)` } : undefined;

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`} style={diffStyle}>
      <span className={styles.accent} />
      <div className={styles.body}>
        <div className={styles.type}>hunt</div>
        <div className={styles.label}>{data.label}</div>
        <div className={styles.meta}>{count} {count === 1 ? 'destination' : 'destinations'}</div>
        <div className={styles.badge}>{strategy}</div>
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
      <Handle className={styles.handle} type="target" position={Position.Left} />
      <Handle className={styles.handle} type="source" position={Position.Right} />
    </div>
  );
}
