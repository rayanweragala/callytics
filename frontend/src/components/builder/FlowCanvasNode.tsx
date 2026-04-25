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
    case 'webhook':
      return styles.webhook;
    case 'queue_login':
      return styles.queueLogin;
    case 'queue':
      return styles.queue;
    case 'callback':
      return styles.callback;
    default:
      return '';
  }
}

export function FlowCanvasNode({ data, selected }: NodeProps<FlowNodeData>) {
  const isWebhookNode = data.type === 'webhook';
  return (
    <div className={`${styles.node} ${toneClass(data.type)} ${selected ? styles.selected : ''} ${isWebhookNode ? styles.webhookSideEffect : ''}`}>
      <span className={styles.accent} />
      <div className={styles.body}>
        <div className={styles.type}>{data.type}</div>
        <div className={styles.label}>{isWebhookNode ? `⚡ ${data.label}` : data.label}</div>
        {data.type === 'get_digits' && typeof data.config.timeout_ms === 'number' ? (
          <div className={styles.meta}>timeout: {Math.round(Number(data.config.timeout_ms) / 1000)}s</div>
        ) : null}
        {data.type === 'transfer' ? (
          <div className={styles.meta}>{String((data.config as Record<string, unknown>).target_value || 'no target')}</div>
        ) : null}
        {data.type === 'hunt' ? (
          <div className={styles.meta}>{Array.isArray((data.config as Record<string, unknown>).destinations) ? `${((data.config as Record<string, unknown>).destinations as unknown[]).length} destination(s)` : 'no destinations'}</div>
        ) : null}
        {data.type === 'business_hours' ? (
          <div className={styles.meta}>
            {String(data.config.timezone || '').trim() || 'Not configured'}
          </div>
        ) : null}
        {data.type === 'voicemail' ? (
          <div className={styles.meta}>{String(data.config.mailbox_name || 'main')}</div>
        ) : null}
        {data.type === 'callback' ? (
          <div className={styles.meta}>{String((data.config as Record<string, unknown>).number_source || 'ani')}</div>
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
      <Handle className={styles.handle} type="target" position={data.type === 'callback' ? Position.Top : Position.Left} />
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
      ) : isWebhookNode ? null : (
        <Handle className={styles.handle} id={data.type === 'voicemail' || data.type === 'callback' ? 'done' : undefined} type="source" position={data.type === 'callback' ? Position.Bottom : Position.Right} />
      )}
    </div>
  );
}
