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
      <div className={styles.header}>
        <div className={styles.title}>Execution Trace</div>
        <button className={styles.closeButton} onClick={onClose} type="button" aria-label="Close execution trace">×</button>
      </div>

      <div className={styles.body}>
        {trace ? (
          <section className={styles.callMeta}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>CALL UUID</span>
              <span className={styles.metaValue}>{trace.callUuid}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>CALLER</span>
              <span className={styles.metaValue}>{trace.callerNumber || '—'}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>STARTED</span>
              <span className={styles.metaValue}>{trace.startTime ? formatDateTime(trace.startTime) : '—'}</span>
            </div>
          </section>
        ) : null}

        {loading ? <Loading message="Loading trace..." /> : null}
        <ErrorMessage message={errorText} />

        {!loading && !errorText && !hasNodes ? <div className={styles.empty}>No trace nodes found.</div> : null}

        {!loading && !errorText && hasNodes ? (
          <div className={styles.timeline}>
            {(trace?.nodes || []).map((node) => (
              <article className={styles.nodeCard} key={node.id}>
                <div className={styles.cardTop}>
                  <span className={styles.nodeBadge}>{node.nodeType}</span>
                  <span className={styles.duration}>{formatDuration(node.durationMs)}</span>
                </div>
                <div className={styles.nodeName}>{node.nodeKey}</div>
                <div className={styles.metaLine}>Exit branch: {node.exitBranch || '—'}</div>
                {node.errorMessage ? <div className={styles.errorText}>{node.errorMessage}</div> : null}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
