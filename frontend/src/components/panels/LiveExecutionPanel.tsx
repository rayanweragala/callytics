import { useMemo } from 'react';
import { LiveDot } from '../LiveDot';
import { Loading } from '../common/Loading';
import { formatRelativeTime } from '../../lib/time';
import type { CallTimelineEvent } from '../../types';
import styles from './LiveExecutionPanel.module.css';

const PAGE_SIZE = 10;

interface LiveExecutionItem {
  callId: string;
  events: CallTimelineEvent[];
}

interface LiveExecutionPanelProps {
  liveCalls: LiveExecutionItem[];
  liveTotal: number;
  page: number;
  setPage: (page: number) => void;
  expandedCalls: Record<string, boolean>;
  toggleCall: (callId: string) => void;
  loading?: boolean;
}

function nodeTone(event: CallTimelineEvent): string {
  if (event.status === 'error') return styles.toneError;
  if (event.nodeType === 'start') return styles.toneActive;
  if (event.nodeType === 'play_audio') return styles.toneInfo;
  if (event.nodeType === 'get_digits') return styles.toneWarning;
  if (event.status === 'completed') return styles.toneCompleted;
  return styles.toneDefault;
}

function hasEnded(events: CallTimelineEvent[]): boolean {
  return events.some((event) => {
    const result = String(event.meta.result || '');
    return (
      event.status === 'error'
      || (event.nodeType === 'hangup' && (event.status === 'completed' || event.status === 'started'))
      || result === 'hangup'
      || result === 'done'
      || String(event.meta.eventType || '') === 'StasisEnd'
    );
  });
}

function isLiveCall(events: CallTimelineEvent[]): boolean {
  if (events.length === 0) {
    return false;
  }

  return !hasEnded(events);
}

function finalStatus(events: CallTimelineEvent[]): string {
  if (events.length === 0) return 'unknown';
  const lastEvent = events[events.length - 1];
  if (lastEvent.status === 'error') return 'failed';
  return hasEnded(events) ? 'completed' : 'live';
}

export function LiveExecutionPanel({ liveCalls, liveTotal, page, setPage, expandedCalls, toggleCall, loading }: LiveExecutionPanelProps) {
  const liveTotalPages = Math.max(1, Math.ceil(liveTotal / PAGE_SIZE));

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>live execution</div>
        <div className={styles.live}><LiveDot active />LIVE</div>
      </div>
      <div className={styles.panelBody}>
        {loading ? (
          <Loading />
        ) : liveCalls.length === 0 ? (
          <div className={styles.empty}>Waiting for calls...</div>
        ) : (
          <div className={styles.groups}>
            {liveCalls.map(({ callId, events }) => {
              const expanded = Boolean(expandedCalls[callId]);
              const live = isLiveCall(events);
              const status = finalStatus(events);
              const lastEvent = events[events.length - 1];
              const caller = String(lastEvent?.meta.callerNumber || 'unknown');

              return (
                <div className={styles.callCard} key={callId}>
                  <button className={styles.callHeader} onClick={() => toggleCall(callId)} type="button" aria-label={`Toggle details for call ${callId}`}>
                    <div className={styles.summaryLeft}>
                      <div className={styles.callId}>{callId}</div>
                      <div className={styles.caller}>from {caller}</div>
                      {live ? (
                        <div className={styles.liveCall}><LiveDot active />LIVE</div>
                      ) : null}
                    </div>
                    <div className={styles.summaryRight}>
                      <div className={styles.finalStatus}>{status}</div>
                      <div className={styles.time} title={new Date(lastEvent?.ts || Date.now()).toISOString()}>
                        {lastEvent ? formatRelativeTime(lastEvent.ts) : '—'}
                      </div>
                      <div className={styles.expandIndicator}>{expanded ? '−' : '+'}</div>
                    </div>
                  </button>

                  {expanded ? (
                    <div className={styles.rail}>
                      {events.map((event) => (
                        <div className={styles.entry} key={`${event.callId}-${event.nodeId}-${event.status}-${event.ts}`}>
                          <div className={`${styles.marker} ${nodeTone(event)}`} />
                          <div className={styles.content}>
                            <div className={styles.node}>{event.nodeType}</div>
                            <div className={styles.status}>{event.status}</div>
                          </div>
                          <div className={styles.time} title={new Date(event.ts).toISOString()}>
                            {formatRelativeTime(event.ts)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.paginationFooter}>
        <button className={styles.paginationButton} disabled={page <= 0} onClick={() => setPage(Math.max(0, page - 1))} type="button" aria-label="Go to previous page">
          ← Newer
        </button>
        <div className={styles.pageIndicator}>{page + 1} / {liveTotalPages}</div>
        <button className={styles.paginationButton} disabled={page >= liveTotalPages - 1} onClick={() => setPage(Math.min(liveTotalPages - 1, page + 1))} type="button" aria-label="Go to next page">
          Older →
        </button>
      </div>
    </section>
  );
}