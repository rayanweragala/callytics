import { useEffect, useMemo, useState } from 'react';
import { getCallTrace } from '../../lib/api';
import { getApiError } from '../../lib/apiError';
import type { CallTraceResponse } from '../../types';
import { Loading } from '../common/Loading';
import { ErrorMessage } from '../common/ErrorMessage';
import { formatDateTime } from '../../lib/time';
import styles from './ExecutionTracePanel.module.css';

interface ExecutionTracePanelProps {
  callUuid: string | null;
  onClose: () => void;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function nodeTypeClass(nodeType: string): string {
  const normalized = nodeType.toLowerCase();
  if (normalized === 'start') return styles.badgeStart;
  if (normalized === 'menu' || normalized === 'get_digits') return styles.badgeMenu;
  if (normalized === 'business_hours') return styles.badgeBusinessHours;
  if (normalized === 'transfer') return styles.badgeTransfer;
  if (normalized === 'voicemail') return styles.badgeVoicemail;
  if (normalized === 'hangup') return styles.badgeHangup;
  return styles.badgeDefault;
}

export function ExecutionTracePanel({ callUuid, onClose }: ExecutionTracePanelProps) {
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [trace, setTrace] = useState<CallTraceResponse | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!callUuid) {
        setTrace(null);
        setErrorText(null);
        return;
      }

      setLoading(true);
      setErrorText(null);
      try {
        const response = await getCallTrace(callUuid);
        if (!active) return;
        setTrace(response);
      } catch (error) {
        if (!active) return;
        setErrorText(getApiError(error, 'failed to load execution trace'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [callUuid]);

  const isOpen = Boolean(callUuid);

  const hasNodes = useMemo(() => (trace?.nodes || []).length > 0, [trace?.nodes]);

  return (
    <aside className={`${styles.panel} ${isOpen ? styles.open : ''}`} aria-hidden={!isOpen}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Execution Trace</h2>
        <button className={styles.closeButton} onClick={onClose} type="button">×</button>
      </div>

      {trace ? (
        <div className={styles.callMeta}>
          <div><span className={styles.metaLabel}>Call UUID</span><span className={styles.metaValue}>{trace.callUuid}</span></div>
          <div><span className={styles.metaLabel}>Caller</span><span className={styles.metaValue}>{trace.callerNumber || '—'}</span></div>
          <div><span className={styles.metaLabel}>Started</span><span className={styles.metaValue}>{trace.startTime ? formatDateTime(trace.startTime) : '—'}</span></div>
        </div>
      ) : null}

      {loading ? <Loading message="Loading trace..." /> : null}
      <ErrorMessage message={errorText} />

      {!loading && !errorText && !hasNodes ? <div className={styles.empty}>No trace nodes found.</div> : null}

      {!loading && !errorText && hasNodes ? (
        <div className={styles.timeline}>
          {(trace?.nodes || []).map((node) => (
            <article className={`${styles.nodeCard} ${node.errorMessage ? styles.failed : ''}`} key={node.id}>
              <div className={styles.cardTop}>
                <span className={`${styles.nodeBadge} ${nodeTypeClass(node.nodeType)}`}>{node.nodeType}</span>
                <span className={styles.duration}>{formatDuration(node.durationMs)}</span>
              </div>
              <div className={styles.nodeKey}>{node.nodeKey}</div>
              <div className={styles.metaLine}>Exit branch: {node.exitBranch || '—'}</div>
              {node.errorMessage ? <div className={styles.errorText}>{node.errorMessage}</div> : null}
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
