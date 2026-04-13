import { Handle, NodeProps, Position } from 'reactflow';
import type { FlowNodeData } from '../../types';
import styles from './FlowCanvasNode.module.css';

function toneClass(type: FlowNodeData['type']): string {
  switch (type) {
    case 'start':
      return styles.start;
    case 'play_audio':
      return styles.playAudio;
    case 'get_digits':
      return styles.getDigits;
    case 'hangup':
      return styles.hangup;
    default:
      return styles.hangup;
  }
}

export function FlowCanvasNode({ data, selected }: NodeProps<FlowNodeData>) {
  return (
    <div className={`${styles.node} ${toneClass(data.type)} ${selected ? styles.selected : ''}`}>
      <span className={styles.accent} />
      <div className={styles.body}>
        <div className={styles.type}>{data.type}</div>
        <div className={styles.label}>{data.label}</div>
        {data.type === 'get_digits' && typeof data.config.timeout_ms === 'number' ? (
          <div className={styles.meta}>timeout: {Math.round(Number(data.config.timeout_ms) / 1000)}s</div>
        ) : null}
      </div>
      {selected && data.type !== 'start' && data.onDelete ? (
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
