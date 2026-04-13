import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { CallTimelineEvent, DiagnosticsSnapshot, SipEndpointStatus } from './types';

const socket: Socket = io('http://localhost:3001', {
  transports: ['websocket'],
});

function formatRelativeTime(ts: number): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  return `${Math.floor(diffSeconds / 3600)}h ago`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}

function statusLabelClass(state: SipEndpointStatus['state']): string {
  if (state === 'registered') return 'badge badge-registered';
  if (state === 'unregistered') return 'badge badge-unregistered';
  return 'badge badge-unknown';
}

function nodeTone(event: CallTimelineEvent): string {
  if (event.status === 'error') return 'tone-error';
  if (event.nodeType === 'start') return 'tone-active';
  if (event.nodeType === 'play_audio') return 'tone-info';
  if (event.nodeType === 'get_digits') return 'tone-warning';
  if (event.status === 'completed') return 'tone-completed';
  return 'tone-default';
}

function StatBar({ metrics }: { metrics: DiagnosticsSnapshot['metrics'] }) {
  const cells = [
    { label: 'ACTIVE CALLS', value: metrics.activeCalls },
    { label: 'REGISTERED ENDPOINTS', value: metrics.registeredEndpoints },
    { label: 'FLOWS', value: metrics.flows },
    { label: 'UPTIME', value: formatUptime(metrics.uptimeSeconds) },
  ];

  return (
    <section className="stat-bar reveal reveal-1">
      {cells.map((cell) => (
        <div className="stat-cell" key={cell.label}>
          <div className="stat-value">{cell.value}</div>
          <div className="stat-label">{cell.label}</div>
        </div>
      ))}
    </section>
  );
}

function EndpointStatusRow({ endpoint }: { endpoint: SipEndpointStatus }) {
  return (
    <div className="endpoint-row" title={endpoint.contacts.join(', ') || 'No active contacts'}>
      <div className="endpoint-name">{endpoint.endpoint}</div>
      <div className="endpoint-address">{endpoint.contacts[0] || '—'}</div>
      <div className={statusLabelClass(endpoint.state)}>
        <span className="badge-dot" />
        {endpoint.state}
      </div>
      <div className="endpoint-since" title={new Date(endpoint.updatedAt).toISOString()}>{formatRelativeTime(endpoint.updatedAt)}</div>
    </div>
  );
}

function SipStatusPanel({ endpoints }: { endpoints: SipEndpointStatus[] }) {
  return (
    <section className="panel reveal reveal-2">
      <div className="panel-header">
        <div className="panel-title">sip endpoints</div>
      </div>
      <div className="endpoint-table">
        {endpoints.length === 0 ? (
          <div className="empty-state">Waiting for endpoint data...</div>
        ) : (
          endpoints.map((endpoint) => <EndpointStatusRow endpoint={endpoint} key={endpoint.endpoint} />)
        )}
      </div>
    </section>
  );
}

function CallTimelinePanel({ timeline }: { timeline: Record<string, CallTimelineEvent[]> }) {
  const orderedCalls = useMemo(() => {
    return Object.entries(timeline)
      .sort((a, b) => (b[1][b[1].length - 1]?.ts || 0) - (a[1][a[1].length - 1]?.ts || 0));
  }, [timeline]);

  return (
    <section className="panel reveal reveal-3">
      <div className="panel-header">
        <div className="panel-title">live execution</div>
        <div className="live-indicator"><span className="pulse-dot" />LIVE</div>
      </div>
      {orderedCalls.length === 0 ? (
        <div className="empty-state centered">Waiting for calls...</div>
      ) : (
        <div className="timeline-groups">
          {orderedCalls.map(([callId, events]) => (
            <div className="timeline-call" key={callId}>
              <div className="timeline-call-id">{callId}</div>
              <div className="timeline-rail">
                {events.map((event) => (
                  <div className="timeline-entry" key={`${event.callId}-${event.nodeId}-${event.status}-${event.ts}`}>
                    <div className={`timeline-marker ${nodeTone(event)}`} />
                    <div className="timeline-content">
                      <div className="timeline-node">{event.nodeType}</div>
                      <div className="timeline-status">{event.status}</div>
                    </div>
                    <div className="timeline-time" title={new Date(event.ts).toISOString()}>{formatRelativeTime(event.ts)}</div>
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

export default function App() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>({
    metrics: {
      activeCalls: 0,
      registeredEndpoints: 0,
      flows: 0,
      uptimeSeconds: 0,
    },
    sipStatuses: [],
    timeline: {},
  });
  const [tick, setTick] = useState(0);

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

    socket.on('diagnostics:bootstrap', handleBootstrap);
    socket.on('diagnostics:sip-status', handleSipStatus);
    socket.on('diagnostics:metrics', handleMetrics);
    socket.on('diagnostics:timeline', handleTimeline);

    return () => {
      socket.off('diagnostics:bootstrap', handleBootstrap);
      socket.off('diagnostics:sip-status', handleSipStatus);
      socket.off('diagnostics:metrics', handleMetrics);
      socket.off('diagnostics:timeline', handleTimeline);
    };
  }, []);

  void tick;

  return (
    <div className="app-shell">
      <aside className="sidebar reveal reveal-1">
        <div>
          <div className="brand-mark">CALLYTICS</div>
          <div className="sidebar-label">CONTROL ROOM</div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <div className="nav-group">
            <div className="nav-group-label">MONITOR</div>
            <button className="nav-item nav-item-active" type="button">diagnostics</button>
            <button className="nav-item" type="button">call logs</button>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">CONFIGURE</div>
            <button className="nav-item" type="button">flow builder</button>
            <button className="nav-item" type="button">audio</button>
            <button className="nav-item" type="button">endpoints</button>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">SYSTEM</div>
            <button className="nav-item" type="button">settings</button>
          </div>
        </nav>

        <div className="sidebar-version">v0.5.0-dev</div>
      </aside>
      <main className="content-area">
        <StatBar metrics={snapshot.metrics} />
        <div className="panel-grid">
          <SipStatusPanel endpoints={snapshot.sipStatuses} />
          <CallTimelinePanel timeline={snapshot.timeline} />
        </div>
      </main>
    </div>
  );
}
