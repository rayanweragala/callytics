import { useMemo } from 'react';
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

export function CallTimelinePanel({ timeline }: CallTimelinePanelProps) {
  const orderedCalls = useMemo(
    () =>
      Object.entries(timeline).sort(
        (a, b) => (b[1][b[1].length - 1]?.ts || 0) - (a[1][a[1].length - 1]?.ts || 0),
      ),
    [timeline],
  );

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
          {orderedCalls.map(([callId, events]) => (
            <div className={styles.callCard} key={callId}>
              <div className={styles.callId}>{callId}</div>
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
