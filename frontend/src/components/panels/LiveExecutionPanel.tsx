import { LiveDot } from '../LiveDot';
import { Loading } from '../common/Loading';
import { formatRelativeTime } from '../../lib/time';
import type { CallTimelineEvent } from '../../types';
import styles from './LiveExecutionPanel.module.css';

const PAGE_SIZE = 10;
const MAX_STEPS = 50;

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
  timelineEvents?: Record<string, CallTimelineEvent[]>;
  loading?: boolean;
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

function nodeTypeLabel(nodeType: string): string {
  switch (nodeType) {
    case 'menu':
      return '[menu]';
    case 'play_audio':
      return '[play]';
    case 'queue':
      return '[queue]';
    case 'hunt':
      return '[hunt]';
    case 'transfer':
      return '[transfer]';
    case 'hangup':
      return '[hangup]';
    case 'start':
      return '[start]';
    case 'webhook':
      return '[webhook]';
    case 'voicemail':
      return '[voicemail]';
    case 'business_hours':
      return '[business_hours]';
    default:
      return '[node]';
  }
}

function truncateNodeId(nodeId: string): string {
  if (nodeId.length <= 24) {
    return nodeId;
  }
  return `${nodeId.slice(0, 21)}...`;
}

function relativeElapsed(eventTs: number, baseTs: number): string {
  const deltaSeconds = Math.max(0, Math.floor((eventTs - baseTs) / 1000));
  return `+${deltaSeconds}s`;
}

function isExecutingEvent(events: CallTimelineEvent[], index: number): boolean {
  const event = events[index];
  if (!event || event.status !== 'started') {
    return false;
  }

  for (let cursor = index + 1; cursor < events.length; cursor += 1) {
    const next = events[cursor];
    if (!next) {
      continue;
    }
    if (next.nodeId === event.nodeId && (next.status === 'completed' || next.status === 'error')) {
      return false;
    }
  }

  return true;
}

function statusToneClass(status: CallTimelineEvent['status']): string {
  if (status === 'started') return styles.toneWarning;
  if (status === 'completed') return styles.toneSuccess;
  return styles.toneError;
}

export function LiveExecutionPanel({
  liveCalls,
  liveTotal,
  page,
  setPage,
  expandedCalls,
  toggleCall,
  timelineEvents,
  loading,
}: LiveExecutionPanelProps) {
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

              const realtimeTimeline = timelineEvents?.[callId] ?? [];
              const sourceEvents = realtimeTimeline.length > 0 ? realtimeTimeline : events;
              const sortedSourceEvents = [...sourceEvents].sort((left, right) => left.ts - right.ts);
              const stepEvents = sortedSourceEvents.slice(-MAX_STEPS);
              const baseTs = sortedSourceEvents[0]?.ts ?? lastEvent?.ts ?? Date.now();

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
                      {stepEvents.map((event, index) => {
                        const result = typeof event.meta.result === 'string' ? event.meta.result : '';
                        const showResult = Boolean(result && result !== 'default');
                        const executing = isExecutingEvent(stepEvents, index);

                        return (
                          <div className={`${styles.entry} ${executing ? styles.executing : ''}`} key={`${event.callId}-${event.nodeId}-${event.status}-${event.ts}`}>
                            <div className={`${styles.marker} ${statusToneClass(event.status)}`} />
                            <div className={styles.content}>
                              <div className={styles.nodeType}>{nodeTypeLabel(event.nodeType)}</div>
                              <div className={styles.nodeKey} title={event.nodeId}>{truncateNodeId(event.nodeId)}</div>
                              {showResult ? <div className={styles.resultTag}>→ {result}</div> : null}
                            </div>
                            <div className={styles.elapsedTime} title={new Date(event.ts).toISOString()}>{relativeElapsed(event.ts, baseTs)}</div>
                          </div>
                        );
                      })}
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
