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
    case 'transfer':
      return styles.transfer;
    case 'business_hours':
      return styles.businessHours;
    case 'voicemail':
      return styles.voicemail;
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
        {data.type === 'transfer' && typeof data.config.destination === 'string' ? (
          <div className={styles.meta}>{String(data.config.destination || 'no destination')}</div>
        ) : null}
        {data.type === 'business_hours' ? (
          <div className={styles.meta}>
            {String(data.config.timezone || '').trim() || 'Not configured'}
          </div>
        ) : null}
        {data.type === 'voicemail' ? (
          <div className={styles.meta}>{String(data.config.mailbox_name || 'main')}</div>
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
      {data.type === 'business_hours' ? (
        <>
          <Handle
            className={`${styles.handle} ${styles.handleOpen}`}
            id="open"
            type="source"
            position={Position.Right}
            style={{ top: '35%' }}
          />
          <Handle
            className={`${styles.handle} ${styles.handleClosed}`}
            id="closed"
            type="source"
            position={Position.Right}
            style={{ top: '70%' }}
          />
        </>
      ) : (
        <Handle className={styles.handle} id={data.type === 'voicemail' ? 'done' : undefined} type="source" position={Position.Right} />
      )}
    </div>
  );
}
