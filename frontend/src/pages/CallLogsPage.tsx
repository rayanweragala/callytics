import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { PageLayout } from '../components/common/PageLayout';
import { ExecutionTracePanel } from '../components/ExecutionTracePanel/ExecutionTracePanel';
import { LiveExecutionPanel } from '../components/panels/LiveExecutionPanel';
import { SipEndpointsPanel } from '../components/panels/SipEndpointsPanel';
import { StatBar } from '../components/StatBar';
import { getDiagnosticsHealth, getDiagnosticsRegistrations, listCallLogs, listFlows } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { diagnosticsSocket } from '../lib/socket';
import type { CallEvent, CallLogItem, CallTimelineEvent, SipEndpointStatus } from '../types';
import styles from './CallLogsPage.module.css';

const PAGE_LIMIT = 10;
const SIP_PAGE_SIZE = 10;

function formatDuration(value: number | null): string {
  if (value === null || value < 0) return '—';
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function endReasonClass(reason: string | null): string {
  if (reason === 'completed') return styles.badgeCompleted;
  if (reason === 'no-answer') return styles.badgeWarning;
  return styles.badgeError;
}

export function CallLogsPage() {
  const [metrics, setMetrics] = useState({ activeCalls: 0, registeredEndpoints: 0, flows: 0, uptimeSeconds: 0 });
  const [sipStatuses, setSipStatuses] = useState<SipEndpointStatus[]>([]);
  const [sipPage, setSipPage] = useState(0);
  const [livePage, setLivePage] = useState(0);
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});
  const [timelineByCall, setTimelineByCall] = useState<Record<string, CallTimelineEvent[]>>({});
  const [timelineEvents, setTimelineEvents] = useState<Record<string, CallTimelineEvent[]>>({});

  const [data, setData] = useState<CallLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [traceCallUuid, setTraceCallUuid] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [endReason, setEndReason] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, endReason]);

  useEffect(() => {
    let active = true;
    const fetchTable = async () => {
      setLoading(true);
      setErrorText(null);
      try {
        const response = await listCallLogs({
          page,
          limit: PAGE_LIMIT,
          search: search || undefined,
          endReason: endReason || undefined,
          dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).toISOString() : undefined,
          dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
        });

        if (!active) return;
        setData(response.data);
        setTotal(response.total);
      } catch (error) {
        if (!active) return;
        setErrorText(getApiError(error, 'failed to load call logs'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchTable();
    return () => {
      active = false;
    };
  }, [page, search, dateFrom, dateTo, endReason]);

  useEffect(() => {
    let active = true;
    const loadTopSection = async () => {
      try {
        const [health, registrations, flows] = await Promise.all([
          getDiagnosticsHealth(),
          getDiagnosticsRegistrations(),
          listFlows(1, 1),
        ]);
        if (!active) return;

        setMetrics({
          activeCalls: health.activeChannels,
          registeredEndpoints: registrations.data.filter((item) => item.status === 'registered').length,
          flows: flows.total,
          uptimeSeconds: health.asterisk.uptimeSeconds || 0,
        });

        setSipStatuses(registrations.data.map((item) => ({
          endpoint: item.name,
          aor: item.name,
          contacts: item.contactUri ? [item.contactUri] : [],
          state: item.status === 'registered' ? 'registered' : item.status === 'unregistered' ? 'unregistered' : 'unknown',
          updatedAt: Date.now(),
        })));
      } catch {
        // Keep top section resilient to partial failures.
      }
    };

    void loadTopSection();
    const timer = window.setInterval(() => {
      void loadTopSection();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const toTimeline = (event: CallEvent): CallTimelineEvent => ({
      callId: event.callId,
      flowId: event.flowId || 0,
      nodeId: event.failedNode || event.type,
      nodeType: event.failedNode || event.type,
      status: event.type === 'failed' ? 'error' : event.type === 'ended' ? 'completed' : 'started',
      ts: Date.parse(event.timestamp || new Date().toISOString()),
      meta: {
        callerNumber: event.caller,
        result: event.type === 'ended' ? 'done' : event.type === 'failed' ? 'hangup' : 'default',
        failureReason: event.failureReason || null,
      },
    });

    const handleCallEvent = (event: CallEvent) => {
      const timelineEvent = toTimeline(event);
      setTimelineByCall((current) => {
        const events = [...(current[event.callId] || []), timelineEvent]
          .sort((a, b) => a.ts - b.ts)
          .slice(-20);
        return {
          ...current,
          [event.callId]: events,
        };
      });
    };

    const handleCallTimeline = (event: CallTimelineEvent) => {
      setTimelineEvents((prev) => {
        const existing = prev[event.callId] ?? [];
        const updated = [...existing, event].slice(-200);
        return { ...prev, [event.callId]: updated };
      });
    };

    if (diagnosticsSocket.connected) {
      diagnosticsSocket.emit('call:subscribe');
    }

    const handleConnect = () => {
      diagnosticsSocket.emit('call:subscribe');
    };

    diagnosticsSocket.on('connect', handleConnect);
    diagnosticsSocket.on('call:event', handleCallEvent);
    diagnosticsSocket.on('call:timeline', handleCallTimeline);

    return () => {
      diagnosticsSocket.emit('call:unsubscribe');
      diagnosticsSocket.off('connect', handleConnect);
      diagnosticsSocket.off('call:event', handleCallEvent);
      diagnosticsSocket.off('call:timeline');
    };
  }, []);

  const liveCalls = useMemo(
    () => Object.entries(timelineByCall)
      .map(([callId, events]) => ({ callId, events }))
      .sort((left, right) => (right.events[right.events.length - 1]?.ts || 0) - (left.events[left.events.length - 1]?.ts || 0)),
    [timelineByCall],
  );

  const pagedLiveCalls = useMemo(() => {
    const start = livePage * 10;
    return liveCalls.slice(start, start + 10);
  }, [liveCalls, livePage]);

  const sipTotalPages = Math.max(1, Math.ceil(sipStatuses.length / SIP_PAGE_SIZE));
  const pagedSipStatuses = useMemo(() => {
    const start = sipPage * SIP_PAGE_SIZE;
    return sipStatuses.slice(start, start + SIP_PAGE_SIZE);
  }, [sipPage, sipStatuses]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <PageLayout subtitle="call history & live execution" title="Call Logs">
      <div className={styles.page}>
        <StatBar metrics={metrics} />

        <section className={styles.topGrid}>
          <LiveExecutionPanel
            liveCalls={pagedLiveCalls}
            liveTotal={liveCalls.length}
            page={livePage}
            setPage={setLivePage}
            expandedCalls={expandedCalls}
            timelineEvents={timelineEvents}
            toggleCall={(callId) => setExpandedCalls((current) => ({ ...current, [callId]: !current[callId] }))}
          />
          <SipEndpointsPanel
            sipStatuses={pagedSipStatuses}
            loading={false}
            page={sipPage}
            totalPages={sipTotalPages}
            onPageChange={setSipPage}
          />
        </section>

        <section className={styles.panel}>
          <div className={styles.filters}>
            <input
              className={styles.input}
              placeholder="Search caller number"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            <input className={styles.input} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <input className={styles.input} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <select className={styles.input} value={endReason} onChange={(event) => setEndReason(event.target.value)}>
              <option value="">All</option>
              <option value="completed">completed</option>
              <option value="no-answer">no-answer</option>
              <option value="busy">busy</option>
              <option value="failed">failed</option>
            </select>
          </div>

          <ErrorMessage message={errorText} />

          <div className={styles.table}>
            <div className={styles.head}>
              <span>Caller number</span>
              <span>Destination</span>
              <span>Flow name</span>
              <span>Duration</span>
              <span>Start time</span>
              <span>End reason</span>
              <span>Trace</span>
            </div>

            {loading ? <div className={styles.empty}>Loading call logs...</div> : null}
            {!loading && data.length === 0 ? <div className={styles.empty}>No call logs found.</div> : null}
            {!loading && data.map((item) => (
              <button className={styles.row} key={`${item.id}-${item.callUuid}`} onClick={() => setTraceCallUuid(item.callUuid)} type="button">
                <span className={styles.mono}>{item.callerNumber || '—'}</span>
                <span className={styles.mono}>{item.calleeNumber || '—'}</span>
                <span>{item.flowName || '—'}</span>
                <span className={styles.mono}>{formatDuration(item.durationSeconds)}</span>
                <span>{item.startedAt ? formatDateTime(item.startedAt) : '—'}</span>
                <span className={`${styles.badge} ${endReasonClass(item.endReason)}`}>{item.endReason || 'unknown'}</span>
                <span className={styles.traceIcon}>{'>'}</span>
              </button>
            ))}
          </div>

          <div className={styles.paginationWrap}>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </section>
      </div>

      <ExecutionTracePanel callUuid={traceCallUuid} onClose={() => setTraceCallUuid(null)} />
    </PageLayout>
  );
}
