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
    case 'conference':
      return styles.conference;
    case 'callback':
      return styles.callback;
    default:
      return '';
  }
}

export function FlowCanvasNode({ data, selected }: NodeProps<FlowNodeData & { diffColor?: string }>) {
  const isWebhookNode = data.type === 'webhook';
  const isTerminalNode = data.type === 'hangup';
  const diffStyle = data.diffColor ? { borderColor: `var(${data.diffColor})`, boxShadow: `0 0 0 2px color-mix(in srgb, var(${data.diffColor}) 20%, transparent)` } : undefined;

  return (
    <div className={`${styles.node} ${toneClass(data.type)} ${selected ? styles.selected : ''} ${isWebhookNode ? styles.webhookSideEffect : ''} ${data.hasValidationError ? styles.invalid : ''}`} style={diffStyle}>
      {data.hasValidationError ? <span className={styles.validationDot} title={data.validationIssues?.join(', ')} /> : null}
      <span className={`${styles.accent} ${isWebhookNode ? styles.webhookAccent : ''}`} />
      <div className={styles.body}>
        <div className={styles.type}>{data.type}</div>
        <div className={styles.label}>{isWebhookNode ? `⚡ ${data.label}` : data.label}</div>
        {isWebhookNode ? <div className={styles.asyncLabel}>async</div> : null}
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
          <div className={styles.meta}>{isNaN(Number(data.config.start_audio_id)) ? 'intro missing' : 'intro set'}</div>
        ) : null}
        {data.type === 'callback' ? (
          <div className={styles.meta}>{String((data.config as Record<string, unknown>).number_source || 'ani')}</div>
        ) : null}
        {data.type === 'conference' ? (
          <div className={styles.meta}>{String((data.config as Record<string, unknown>).roomName || 'no room')}</div>
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
      <Handle
        className={styles.handle}
        type="target"
        position={data.type === 'callback' ? Position.Top : Position.Left}
        isConnectableStart={false}
      />
      {data.type === 'business_hours' ? (
        <>
          <Handle
            className={`${styles.handle} ${styles.handleOpen}`}
            id="open"
            type="source"
            position={Position.Right}
            style={{ top: '35%' }}
            isConnectableEnd={false}
          />
          <Handle
            className={`${styles.handle} ${styles.handleClosed}`}
            id="closed"
            type="source"
            position={Position.Right}
            style={{ top: '70%' }}
            isConnectableEnd={false}
          />
        </>
      ) : isTerminalNode ? null : (
        <Handle className={styles.handle} type="source" position={Position.Right} isConnectableEnd={false} />
      )}
    </div>
  );
}
