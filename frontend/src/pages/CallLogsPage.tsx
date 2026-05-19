import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { PageLayout } from '../components/common/PageLayout';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { ExecutionTracePanel } from '../components/ExecutionTracePanel/ExecutionTracePanel';
import { QualityDrawer } from '../components/quality/QualityDrawer';
import { LiveExecutionPanel } from '../components/panels/LiveExecutionPanel';
import { SipEndpointsPanel } from '../components/panels/SipEndpointsPanel';
import { exportCallLogsCsv, getCallQuality, getDiagnosticsRegistrations, listCallLogs } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { diagnosticsSocket } from '../lib/socket';
import type { CallEvent, CallLogItem, CallQuality, CallTimelineEvent, SipEndpointStatus } from '../types';
import styles from './CallLogsPage.module.css';

const PAGE_LIMIT = 10;
const SIP_PAGE_SIZE = 10;
const END_REASON_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'completed', label: 'completed' },
  { value: 'no-answer', label: 'no-answer' },
  { value: 'busy', label: 'busy' },
  { value: 'failed', label: 'failed' },
];

function formatDuration(value: number | null): string {
  if (value === null || value < 0) return '—';
  const mins = Math.floor(value / 60);
  const secs = value % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function shiftIso(value: string | null, deltaMs: number): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed + deltaMs).toISOString();
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function endReasonClass(reason: string | null): string {
  if (reason === 'completed') return styles.badgeCompleted;
  if (reason === 'no-answer') return styles.badgeWarning;
  return styles.badgeError;
}

function mosGradeClass(grade: CallQuality['grade']): string {
  if (grade === 'good') return styles.mosGood;
  if (grade === 'fair') return styles.mosFair;
  return styles.mosPoor;
}

function MosBadge({
  grade,
  mos,
  onClick,
}: {
  grade: CallQuality['grade'];
  mos: number;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button className={`${styles.mosBadge} ${mosGradeClass(grade)}`} onClick={onClick} type="button">
      {mos.toFixed(2)}
    </button>
  );
}

export function CallLogsPage() {
  const navigate = useNavigate();
  const [sipStatuses, setSipStatuses] = useState<SipEndpointStatus[]>([]);
  const [sipPage, setSipPage] = useState(0);
  const [livePage, setLivePage] = useState(0);
  const [expandedCalls, setExpandedCalls] = useState<Record<string, boolean>>({});
  const [timelineByCall, setTimelineByCall] = useState<Record<string, CallTimelineEvent[]>>({});
  const [timelineEvents, setTimelineEvents] = useState<Record<string, CallTimelineEvent[]>>({});

  const [data, setData] = useState<CallLogItem[]>([]);
  const [qualityByCall, setQualityByCall] = useState<Record<string, CallQuality | null>>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [traceCallUuid, setTraceCallUuid] = useState<string | null>(null);
  const [qualityDrawerCallId, setQualityDrawerCallId] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isSipLoading, setIsSipLoading] = useState(true);

  const [searchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [endReason, setEndReason] = useState('');
  const [direction, setDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const callLogIdParam = Number(searchParams.get('callLogId') || 0) || undefined;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, endReason, direction]);

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
          direction: direction === 'all' ? undefined : direction,
          callLogId: callLogIdParam,
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
  }, [page, search, dateFrom, dateTo, endReason, direction, callLogIdParam]);

  useEffect(() => {
    let active = true;

    const loadQuality = async () => {
      if (data.length === 0) {
        return;
      }

      const calls = data.map((item) => item.callUuid).filter(Boolean);
      const missing = calls.filter((callId) => !(callId in qualityByCall));
      if (missing.length === 0) {
        return;
      }

      const results = await Promise.all(
        missing.map(async (callId) => ({ callId, quality: await getCallQuality(callId) })),
      );

      if (!active) {
        return;
      }

      setQualityByCall((current) => {
        const next = { ...current };
        for (const item of results) {
          next[item.callId] = item.quality;
        }
        return next;
      });
    };

    void loadQuality();

    return () => {
      active = false;
    };
  }, [data, qualityByCall]);

  useEffect(() => {
    let active = true;
    const loadTopSection = async () => {
      try {
        const registrations = await getDiagnosticsRegistrations();
        if (!active) return;

        setSipStatuses(registrations.extensions.map((item) => ({
          endpoint: item.extension,
          aor: item.extension,
          contacts: item.registeredIp ? [item.registeredIp] : [],
          state: item.status,
          updatedAt: Date.now(),
        })));
      } catch {
        // Keep top section resilient to partial failures.
      } finally {
        if (active) setIsSipLoading(false);
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
  const showPagination = total > 0;
  const hasActiveFilters = Boolean(searchInput.trim() || dateFrom || dateTo || endReason || direction !== 'all');
  const showLiveExecutionPanel = liveCalls.length > 0;
  const blockingLoadError = !loading ? errorText : null;
  const exportParams = useMemo(() => ({
    search: search || undefined,
    endReason: endReason || undefined,
    dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).toISOString() : undefined,
    dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
    direction: direction === 'all' ? undefined : direction,
  }), [search, endReason, dateFrom, dateTo, direction]);

  return (
    <PageLayout subtitle="monitor" title="Call Logs">
      <div className={styles.page}>
        {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
        {!blockingLoadError ? (
          <>
        <div className={styles.pageHeader}>
          <button
            className={`${styles.traceButton} ${styles.logsButton}`}
            type="button"
            disabled={exportingCsv}
            onClick={async () => {
              setExportError(null);
              setExportingCsv(true);
              try {
                const csv = await exportCallLogsCsv(exportParams);
                triggerDownload(csv.blob, csv.filename);
              } catch (error) {
                setExportError(getApiError(error, 'failed to export CSV'));
              } finally {
                setExportingCsv(false);
              }
            }}
          >
            {exportingCsv ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
        {exportError ? <ErrorMessage message={exportError} /> : null}
        <section className={`${styles.topGrid} ${showLiveExecutionPanel ? '' : styles.topGridSingle}`}>
          {showLiveExecutionPanel ? (
            <LiveExecutionPanel
              liveCalls={pagedLiveCalls}
              liveTotal={liveCalls.length}
              page={livePage}
              setPage={setLivePage}
              expandedCalls={expandedCalls}
              timelineEvents={timelineEvents}
              toggleCall={(callId) => setExpandedCalls((current) => ({ ...current, [callId]: !current[callId] }))}
            />
          ) : null}
          <SipEndpointsPanel
            sipStatuses={pagedSipStatuses}
            loading={isSipLoading}
            page={sipPage}
            totalPages={sipTotalPages}
            onPageChange={setSipPage}
          />
        </section>

        <div className={styles.filters}>
          <input
            className={styles.input}
            placeholder="Search caller number"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <input className={styles.input} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          <input className={styles.input} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          <SearchableSelect
            options={END_REASON_OPTIONS}
            value={endReason}
            onChange={(value) => setEndReason(value || '')}
            placeholder="All"
          />
          {hasActiveFilters ? (
            <button
              className={styles.clearFiltersButton}
              type="button"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setDateFrom('');
                setDateTo('');
                setEndReason('');
                setDirection('all');
                setPage(1);
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className={styles.filterPills}>
          <button className={`${styles.filterPill} ${direction === 'all' ? styles.filterPillActive : ''}`} type="button" onClick={() => setDirection('all')}>All</button>
          <button className={`${styles.filterPill} ${direction === 'inbound' ? styles.filterPillActive : ''}`} type="button" onClick={() => setDirection('inbound')}>Inbound</button>
          <button className={`${styles.filterPill} ${direction === 'outbound' ? styles.filterPillActive : ''}`} type="button" onClick={() => setDirection('outbound')}>Outbound</button>
        </div>

        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Caller</th>
                <th>Direction</th>
                <th>Flow</th>
                <th>Campaign</th>
                <th>Duration</th>
                <th>Quality</th>
                <th>Date</th>
                <th>End reason</th>
                <th>Logs</th>
                <th className={styles.actionsHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: PAGE_LIMIT }).map((_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={index} className={styles.skeletonRow}>
                    {Array.from({ length: 10 }).map((__, col) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <td key={col}><span className={styles.skeletonCell} /></td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={10} className={styles.emptyState}>No call logs found.</td>
                </tr>
              ) : data.map((item) => {
                const quality = qualityByCall[item.callUuid];
                const from = shiftIso(item.startedAt, -10000);
                const to = shiftIso(item.endedAt ?? item.startedAt, 10000);
                const hasLogsDrillDown = Boolean(item.callUuid && from && to);
                return (
                  <tr
                    key={`${item.id}-${item.callUuid}`}
                    className={styles.logRow}
                    onClick={() => setTraceCallUuid(item.callUuid)}
                  >
                    <td className={styles.mono}>{item.callerNumber || '—'}</td>
                    <td className={styles.mono}>{item.direction || '—'}</td>
                    <td className={styles.flowName}>{item.flowName || '—'}</td>
                    <td className={styles.flowName}>{item.campaignName || '—'}</td>
                    <td className={styles.mono}>{formatDuration(item.durationSeconds)}</td>
                    <td>
                      {quality ? (
                        <MosBadge
                          grade={quality.grade}
                          mos={quality.mos}
                          onClick={(event) => {
                            event.stopPropagation();
                            setQualityDrawerCallId(item.callUuid);
                          }}
                        />
                      ) : (
                        <span className={styles.missingQuality}>—</span>
                      )}
                    </td>
                    <td className={styles.timestamp}>{item.startedAt ? formatDateTime(item.startedAt) : '—'}</td>
                    <td><span className={`${styles.badge} ${endReasonClass(item.endReason)}`}>{item.endReason || 'unknown'}</span></td>
                    <td>
                      <button
                        className={`${styles.traceButton} ${styles.logsButton}`}
                        disabled={!hasLogsDrillDown}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!hasLogsDrillDown || !from || !to) return;
                          const params = new URLSearchParams({
                            uniqueid: item.callUuid,
                            from,
                            to,
                          });
                          if (item.callerNumber) {
                            params.set('callerNumber', item.callerNumber);
                          }
                          if (item.calleeNumber) {
                            params.set('destination', item.calleeNumber);
                          }
                          navigate(`/logs?${params.toString()}`);
                        }}
                        type="button"
                      >
                        Logs
                      </button>
                    </td>
                    <td className={styles.traceCell}>
                      <button
                        className={styles.traceButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTraceCallUuid(item.callUuid);
                        }}
                        type="button"
                      >
                        {'>'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {showPagination ? (
            <div className={styles.paginationWrap}>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          ) : null}
        </div>
          </>
        ) : null}
      </div>

      <ExecutionTracePanel callUuid={traceCallUuid} onClose={() => setTraceCallUuid(null)} />
      <QualityDrawer callId={qualityDrawerCallId} onClose={() => setQualityDrawerCallId(null)} />
    </PageLayout>
  );
}
