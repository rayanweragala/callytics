import { useEffect, useState } from 'react';
import { StatBar } from '../components/StatBar';
import { SipEndpointsPanel } from '../components/panels/SipEndpointsPanel';
import { LiveExecutionPanel } from '../components/panels/LiveExecutionPanel';
import { diagnosticsSocket } from '../lib/socket';
import type { DiagnosticsSnapshot, SipEndpointStatus, CallTimelineEvent } from '../types';
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

function requestDiagnosticsList<T>(eventName: string, offset: number): Promise<PaginatedDiagnosticsResult<T>> {
  return new Promise((resolve) => {
    diagnosticsSocket.emit(eventName, { limit: PAGE_SIZE, offset }, (response: PaginatedDiagnosticsResult<T>) => {
      resolve(response);
    });
  });
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
        <SipEndpointsPanel
          sipStatuses={sipStatuses}
          page={sipPage}
          totalPages={sipTotalPages}
          onPageChange={setSipPage}
        />
        <LiveExecutionPanel
          liveCalls={liveCalls}
          liveTotal={liveTotal}
          page={page}
          setPage={setPage}
          expandedCalls={expandedCalls}
          toggleCall={toggleCall}
        />
      </div>
    </div>
  );
}
