import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRelativeTime } from '../lib/time';
import type { CallTimelineEvent } from '../types';
import { LiveDot } from './LiveDot';
import styles from './CallTimelinePanel.module.css';

interface CallTimelinePanelProps {
  timeline: Record<string, CallTimelineEvent[]>;
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

export function CallTimelinePanel({ timeline }: CallTimelinePanelProps) {
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});
  const [interactedCalls, setInteractedCalls] = useState<Record<string, boolean>>({});
  const latestEventRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const orderedCalls = useMemo(
    () =>
      Object.entries(timeline).sort(
        (a, b) => (b[1][b[1].length - 1]?.ts || 0) - (a[1][a[1].length - 1]?.ts || 0),
      ),
    [timeline],
  );

  useEffect(() => {
    setExpandedCalls((current) => {
      const next = { ...current };
      const validIds = new Set(orderedCalls.map(([callId]) => callId));

      for (const callId of Object.keys(next)) {
        if (!validIds.has(callId)) {
          delete next[callId];
        }
      }

      const newestCallId = orderedCalls[0]?.[0];

      for (const [callId, events] of orderedCalls) {
        if (interactedCalls[callId]) {
          continue;
        }

        if ((newestCallId && callId === newestCallId) || isLiveCall(events)) {
          next[callId] = true;
        } else if (next[callId] === undefined) {
          next[callId] = false;
        }
      }

      return next;
    });
  }, [interactedCalls, orderedCalls]);

  useEffect(() => {
    for (const [callId, events] of orderedCalls) {
      if (expandedCalls[callId] && isLiveCall(events)) {
        latestEventRefs.current[callId]?.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [expandedCalls, orderedCalls]);

  const toggleCall = (callId: string) => {
    setInteractedCalls((current) => ({
      ...current,
      [callId]: true,
    }));
    setExpandedCalls((current) => ({
      ...current,
      [callId]: !current[callId],
    }));
  };

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.title}>live execution</div>
        <div className={styles.live}><LiveDot active />LIVE</div>
      </div>
      {orderedCalls.length === 0 ? (
        <div className={styles.empty}>Waiting for calls...</div>
      ) : (
        <div className={styles.groups}>
          {orderedCalls.map(([callId, events]) => {
            const expanded = Boolean(expandedCalls[callId]);
            const live = isLiveCall(events);
            const status = finalStatus(events);
            const lastEvent = events[events.length - 1];
            const caller = String(lastEvent?.meta.callerNumber || 'unknown');

            return (
              <div className={styles.callCard} key={callId}>
                <button className={styles.callHeader} onClick={() => toggleCall(callId)} type="button">
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
                    {events.map((event, index) => (
                      <div
                        className={styles.entry}
                        key={`${event.callId}-${event.nodeId}-${event.status}-${event.ts}`}
                        ref={(element) => {
                          if (index === events.length - 1) {
                            latestEventRefs.current[callId] = element;
                          }
                        }}
                      >
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
    </section>
  );
}
