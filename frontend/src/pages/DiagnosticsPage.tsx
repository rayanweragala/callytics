import { useEffect, useMemo, useState } from 'react';
import { CallTimelinePanel } from '../components/CallTimelinePanel';
import { EndpointStatusRow } from '../components/EndpointStatusRow';
import { StatBar } from '../components/StatBar';
import { diagnosticsSocket } from '../lib/socket';
import type { DiagnosticsSnapshot, SipEndpointStatus, CallTimelineEvent } from '../types';
import styles from './DiagnosticsPage.module.css';

export function DiagnosticsPage() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>({
    metrics: { activeCalls: 0, registeredEndpoints: 0, flows: 0, uptimeSeconds: 0 },
    sipStatuses: [],
    timeline: {},
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleBootstrap = (next: DiagnosticsSnapshot) => setSnapshot(next);
    const handleSipStatus = (sipStatuses: SipEndpointStatus[]) => {
      setSnapshot((current) => ({ ...current, sipStatuses }));
    };
    const handleMetrics = (metrics: DiagnosticsSnapshot['metrics']) => {
      setSnapshot((current) => ({ ...current, metrics }));
    };
    const handleTimeline = (payload: { callId: string; events: CallTimelineEvent[] }) => {
      requestAnimationFrame(() => {
        setSnapshot((current) => ({
          ...current,
          timeline: {
            ...current.timeline,
            [payload.callId]: payload.events,
          },
        }));
      });
    };

    diagnosticsSocket.on('diagnostics:bootstrap', handleBootstrap);
    diagnosticsSocket.on('diagnostics:sip-status', handleSipStatus);
    diagnosticsSocket.on('diagnostics:metrics', handleMetrics);
    diagnosticsSocket.on('diagnostics:timeline', handleTimeline);

    return () => {
      diagnosticsSocket.off('diagnostics:bootstrap', handleBootstrap);
      diagnosticsSocket.off('diagnostics:sip-status', handleSipStatus);
      diagnosticsSocket.off('diagnostics:metrics', handleMetrics);
      diagnosticsSocket.off('diagnostics:timeline', handleTimeline);
    };
  }, []);

  const endpointRows = useMemo(
    () => snapshot.sipStatuses.map((endpoint) => <EndpointStatusRow endpoint={endpoint} key={endpoint.endpoint} />),
    [snapshot.sipStatuses],
  );

  return (
    <div className={styles.page}>
      <StatBar metrics={snapshot.metrics} />
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.header}>
            <div className={styles.title}>sip endpoints</div>
          </div>
          <div className={styles.endpointTable}>
            {endpointRows.length === 0 ? <div className={styles.empty}>Waiting for endpoint data...</div> : endpointRows}
          </div>
        </section>
        <CallTimelinePanel timeline={snapshot.timeline} />
      </div>
    </div>
  );
}
