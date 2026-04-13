import { useEffect, useMemo, useState } from 'react';
import { EndpointStatusRow } from '../components/EndpointStatusRow';
import { LiveDot } from '../components/LiveDot';
import { StatBar } from '../components/StatBar';
import { diagnosticsSocket } from '../lib/socket';
import { formatRelativeTime } from '../lib/time';
import type { CallTimelineEvent, DiagnosticsSnapshot, SipEndpointStatus } from '../types';
import styles from './DiagnosticsPage.module.css';

const PAGE_SIZE = 10;

interface PaginatedDiagnosticsResult<T> {
  data: T[];
  total: number;
}

interface LiveExecutionItem {
  callId: string;
  events: CallTimelineEvent[];
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

function requestDiagnosticsList<T>(eventName: string, offset: number): Promise<PaginatedDiagnosticsResult<T>> {
  return new Promise((resolve) => {
    diagnosticsSocket.emit(eventName, { limit: PAGE_SIZE, offset }, (response: PaginatedDiagnosticsResult<T>) => {
      resolve(response);
    });
  });
}

export function DiagnosticsPage() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot>({
    metrics: { activeCalls: 0, registeredEndpoints: 0, flows: 0, uptimeSeconds: 0 },
    sipStatuses: [],
    timeline: {},
  });
  const [, setTick] = useState(0);
  const [page, setPage] = useState(0);
  const [sipPage, setSipPage] = useState(0);
  const [liveCalls, setLiveCalls] = useState<LiveExecutionItem[]>([]);
  const [liveTotal, setLiveTotal] = useState(0);
  const [sipStatuses, setSipStatuses] = useState<SipEndpointStatus[]>([]);
  const [sipTotal, setSipTotal] = useState(0);
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});
  const [interactedCalls, setInteractedCalls] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLiveExecutionPage = async () => {
      const response = await requestDiagnosticsList<LiveExecutionItem>('diagnostics:live-execution:list', page * PAGE_SIZE);
      if (cancelled) {
        return;
      }

      const maxPage = Math.max(0, Math.ceil(response.total / PAGE_SIZE) - 1);
      if (page > maxPage) {
        setPage(maxPage);
        return;
      }

      setLiveCalls(response.data);
      setLiveTotal(response.total);
    };

    void loadLiveExecutionPage();

    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => {
    let cancelled = false;

    const loadSipPage = async () => {
      const response = await requestDiagnosticsList<SipEndpointStatus>('diagnostics:sip-status:list', sipPage * PAGE_SIZE);
      if (cancelled) {
        return;
      }

      const maxPage = Math.max(0, Math.ceil(response.total / PAGE_SIZE) - 1);
      if (sipPage > maxPage) {
        setSipPage(maxPage);
        return;
      }

      setSipStatuses(response.data);
      setSipTotal(response.total);
    };

    void loadSipPage();

    return () => {
      cancelled = true;
    };
  }, [sipPage]);

  useEffect(() => {
    const handleBootstrap = (next: DiagnosticsSnapshot) => {
      setSnapshot((current) => ({ ...current, metrics: next.metrics }));
    };
    const handleSipStatus = () => {
      void requestDiagnosticsList<SipEndpointStatus>('diagnostics:sip-status:list', sipPage * PAGE_SIZE).then((response) => {
        const maxPage = Math.max(0, Math.ceil(response.total / PAGE_SIZE) - 1);
        if (sipPage > maxPage) {
          setSipPage(maxPage);
          return;
        }
        setSipStatuses(response.data);
        setSipTotal(response.total);
      });
    };
    const handleMetrics = (metrics: DiagnosticsSnapshot['metrics']) => {
      setSnapshot((current) => ({ ...current, metrics }));
    };
    const handleTimeline = () => {
      void requestDiagnosticsList<LiveExecutionItem>('diagnostics:live-execution:list', page * PAGE_SIZE).then((response) => {
        const maxPage = Math.max(0, Math.ceil(response.total / PAGE_SIZE) - 1);
        if (page > maxPage) {
          setPage(maxPage);
          return;
        }
        setLiveCalls(response.data);
        setLiveTotal(response.total);
      });
    };
    const handleConnect = () => {
      handleTimeline();
      handleSipStatus();
    };

    diagnosticsSocket.on('connect', handleConnect);
    diagnosticsSocket.on('diagnostics:bootstrap', handleBootstrap);
    diagnosticsSocket.on('diagnostics:sip-status', handleSipStatus);
    diagnosticsSocket.on('diagnostics:metrics', handleMetrics);
    diagnosticsSocket.on('diagnostics:timeline', handleTimeline);

    return () => {
      diagnosticsSocket.off('connect', handleConnect);
      diagnosticsSocket.off('diagnostics:bootstrap', handleBootstrap);
      diagnosticsSocket.off('diagnostics:sip-status', handleSipStatus);
      diagnosticsSocket.off('diagnostics:metrics', handleMetrics);
      diagnosticsSocket.off('diagnostics:timeline', handleTimeline);
    };
  }, [page, sipPage]);

  useEffect(() => {
    setExpandedCalls((current) => {
      const next = { ...current };
      const validIds = new Set(liveCalls.map((call) => call.callId));

      for (const callId of Object.keys(next)) {
        if (!validIds.has(callId)) {
          delete next[callId];
        }
      }

      const newestCallId = liveCalls[0]?.callId;

      for (const call of liveCalls) {
        if (interactedCalls[call.callId]) {
          continue;
        }

        if ((newestCallId && call.callId === newestCallId) || isLiveCall(call.events)) {
          next[call.callId] = true;
        } else if (next[call.callId] === undefined) {
          next[call.callId] = false;
        }
      }

      return next;
    });
  }, [interactedCalls, liveCalls]);

  const endpointRows = useMemo(
    () => sipStatuses.map((endpoint) => <EndpointStatusRow endpoint={endpoint} key={endpoint.endpoint} />),
    [sipStatuses],
  );

  const liveTotalPages = Math.max(1, Math.ceil(liveTotal / PAGE_SIZE));
  const sipTotalPages = Math.max(1, Math.ceil(sipTotal / PAGE_SIZE));

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
    <div className={styles.page}>
      <StatBar metrics={snapshot.metrics} />
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.header}>
            <div className={styles.title}>sip endpoints</div>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.endpointTable}>
              {endpointRows.length === 0 ? <div className={styles.empty}>Waiting for endpoint data...</div> : endpointRows}
            </div>
          </div>
          <div className={styles.paginationFooter}>
            <button className={styles.paginationButton} disabled={sipPage <= 0} onClick={() => setSipPage((current) => Math.max(0, current - 1))} type="button">
              ← Newer
            </button>
            <div className={styles.pageIndicator}>{sipPage + 1} / {sipTotalPages}</div>
            <button className={styles.paginationButton} disabled={sipPage >= sipTotalPages - 1} onClick={() => setSipPage((current) => Math.min(sipTotalPages - 1, current + 1))} type="button">
              Older →
            </button>
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.header}>
            <div className={styles.title}>live execution</div>
            <div className={styles.live}><LiveDot active />LIVE</div>
          </div>
          <div className={styles.panelBody}>
            {liveCalls.length === 0 ? (
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
            <button className={styles.paginationButton} disabled={page <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">
              ← Newer
            </button>
            <div className={styles.pageIndicator}>{page + 1} / {liveTotalPages}</div>
            <button className={styles.paginationButton} disabled={page >= liveTotalPages - 1} onClick={() => setPage((current) => Math.min(liveTotalPages - 1, current + 1))} type="button">
              Older →
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
