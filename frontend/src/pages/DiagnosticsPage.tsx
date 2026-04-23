import { useEffect, useMemo, useRef, useState } from 'react';
import { CallFailuresPanel } from '../components/diagnostics/CallFailuresPanel';
import { SipRegistrationPanel } from '../components/diagnostics/SipRegistrationPanel';
import { SipTrafficInspector } from '../components/diagnostics/SipTrafficInspector';
import { SystemHealthPanel } from '../components/diagnostics/SystemHealthPanel';
import { TrunkHealthPanel } from '../components/diagnostics/TrunkHealthPanel';
import { ExecutionTracePanel } from '../components/ExecutionTracePanel/ExecutionTracePanel';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { PageLayout } from '../components/common/PageLayout';
import { SkeletonCard, SkeletonRow } from '../components/common/skeleton';
import {
  getDiagnosticsFailures,
  getDiagnosticsHealth,
  getDiagnosticsRegistrations,
  getDiagnosticsSipMessages,
  listTrunks,
  testDiagnosticsTrunk,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { diagnosticsSocket } from '../lib/socket';
import type {
  DiagnosticsFailureItem,
  DiagnosticsSystemHealth,
  SipRegistrationItem,
  SipTrafficItem,
  SipTrunkItem,
  TrunkDiagnosticsResult,
} from '../types';
import { SipLadderPanel } from '../components/diagnostics/SipLadderPanel';
import styles from './DiagnosticsPage.module.css';

const FAILURES_PAGE_SIZE = 20;

export function DiagnosticsPage() {
  const [health, setHealth] = useState<DiagnosticsSystemHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [isHealthInitial, setIsHealthInitial] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState<SipRegistrationItem[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(true);
  const [isRegistrationsInitial, setIsRegistrationsInitial] = useState(true);
  const [registrationsError, setRegistrationsError] = useState<string | null>(null);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);
  const [isTrunksInitial, setIsTrunksInitial] = useState(true);
  const [trunksError, setTrunksError] = useState<string | null>(null);
  const [trunkResults, setTrunkResults] = useState<Record<number, TrunkDiagnosticsResult>>({});
  const [busyIds, setBusyIds] = useState<number[]>([]);
  const [testingAll, setTestingAll] = useState(false);
  const [traffic, setTraffic] = useState<SipTrafficItem[]>([]);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [failures, setFailures] = useState<DiagnosticsFailureItem[]>([]);
  const [isFailuresInitial, setIsFailuresInitial] = useState(true);
  const [failuresError, setFailuresError] = useState<string | null>(null);
  const [failuresPage, setFailuresPage] = useState(1);
  const [failuresTotal, setFailuresTotal] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [traceCallUuid, setTraceCallUuid] = useState<string | null>(null);
  const [ladderCallId, setLadderCallId] = useState<string | null>(null);
  const [ladderFailedAt, setLadderFailedAt] = useState<string | undefined>(undefined);
  const [ladderError, setLadderError] = useState<string | undefined>(undefined);
  const successTimerRef = useRef<number | null>(null);

  const failureTotalPages = Math.max(1, Math.ceil(failuresTotal / FAILURES_PAGE_SIZE));

  const refreshHealth = async () => {
    setHealthError(null);
    try {
      const response = await getDiagnosticsHealth();
      setHealth(response);
    } catch (error) {
      setHealthError(getApiError(error, 'failed to load health'));
    } finally {
      setHealthLoading(false);
      setIsHealthInitial(false);
    }
  };

  const refreshRegistrations = async () => {
    setRegistrationsError(null);
    try {
      const response = await getDiagnosticsRegistrations();
      setRegistrations(response.data);
    } catch (error) {
      setRegistrationsError(getApiError(error, 'failed to load registrations'));
    } finally {
      setRegistrationsLoading(false);
      setIsRegistrationsInitial(false);
    }
  };

  const refreshTrunks = async () => {
    setTrunksError(null);
    try {
      const response = await listTrunks(100, 0);
      setTrunks(response.data);
    } catch (error) {
      setTrunksError(getApiError(error, 'failed to load trunks'));
    } finally {
      setIsTrunksInitial(false);
    }
  };

  const refreshFailures = async (page: number) => {
    setFailuresError(null);
    try {
      const offset = (page - 1) * FAILURES_PAGE_SIZE;
      const response = await getDiagnosticsFailures(FAILURES_PAGE_SIZE, offset);
      setFailures(response.data.map((item: any, index: number) => ({
        id: item.id ?? index + 1,
        callId: item.callId,
        callUuid: item.callUuid ?? item.callId,
        time: item.startedAt ?? item.time,
        callerId: item.callerNumber ?? item.callerId ?? null,
        flowName: item.flowName ?? null,
        failedNodeType: item.failedNodeType ?? null,
        errorMessage: item.errorMessage ?? null,
        durationSeconds: item.durationSeconds ?? null,
      })));
      setFailuresTotal(response.total);
    } catch (error) {
      setFailuresError(getApiError(error, 'failed to load failures'));
    } finally {
      setIsFailuresInitial(false);
    }
  };

  useEffect(() => {
    void refreshHealth();
    void refreshRegistrations();
    void refreshTrunks();
  }, []);

  useEffect(() => {
    void refreshFailures(failuresPage);
  }, [failuresPage]);

  useEffect(() => {
    const healthTimer = window.setInterval(() => {
      void refreshHealth();
    }, 10000);
    const registrationsTimer = window.setInterval(() => {
      void refreshRegistrations();
      void refreshFailures(failuresPage);
    }, 30000);

    return () => {
      window.clearInterval(healthTimer);
      window.clearInterval(registrationsTimer);
    };
  }, [failuresPage]);

  useEffect(() => {
    const handleTraffic = (item: SipTrafficItem) => {
      setTraffic((current) => [...current, item].slice(-200));
    };
    const handleConnect = () => {
      diagnosticsSocket.emit('sip:traffic:subscribe');
    };

    if (diagnosticsSocket.connected) {
      diagnosticsSocket.emit('sip:traffic:subscribe');
    }

    diagnosticsSocket.on('connect', handleConnect);
    diagnosticsSocket.on('sip:traffic', handleTraffic);
    return () => {
      diagnosticsSocket.emit('sip:traffic:unsubscribe');
      diagnosticsSocket.off('connect', handleConnect);
      diagnosticsSocket.off('sip:traffic', handleTraffic);
    };
  }, []);

  useEffect(() => {
    if (!pageError) {
      return;
    }

    const timer = window.setTimeout(() => setPageError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [pageError]);

  useEffect(() => {
    if (!successText) {
      return;
    }

    if (successTimerRef.current) {
      window.clearTimeout(successTimerRef.current);
    }

    successTimerRef.current = window.setTimeout(() => setSuccessText(null), 6000);
    return () => {
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, [successText]);

  const handleTestTrunk = async (id: number) => {
    setBusyIds((current) => [...current, id]);
    try {
      const result = await testDiagnosticsTrunk(id);
      setTrunkResults((current) => ({ ...current, [id]: result }));
      const trunkName = trunks.find((item) => item.id === id)?.name || `trunk ${id}`;
      if (result.status === 'reachable') {
        setSuccessText(`Trunk "${trunkName}" is reachable — TCP and SIP both responding.`);
      } else if (result.status === 'sip_unreachable') {
        setSuccessText(`Trunk "${trunkName}" TCP reachable but SIP OPTIONS failed. Check remote SIP stack.`);
      } else if (result.status === 'unreachable') {
        setPageError(result.message || `Trunk "${trunkName}" is unreachable.`);
      }
    } catch (error) {
      setPageError(getApiError(error, 'failed to test trunk'));
    } finally {
      setBusyIds((current) => current.filter((value) => value !== id));
    }
  };

  const handleTestAll = async () => {
    setTestingAll(true);
    try {
      for (let index = 0; index < trunks.length; index += 1) {
        const trunk = trunks[index];
        setBusyIds((current) => current.includes(trunk.id) ? current : [...current, trunk.id]);
        try {
          const result = await testDiagnosticsTrunk(trunk.id);
          setTrunkResults((current) => ({ ...current, [trunk.id]: result }));
        } finally {
          setBusyIds((current) => current.filter((value) => value !== trunk.id));
        }

        if (index < trunks.length - 1) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 500);
          });
        }
      }
      setSuccessText('All trunk tests complete.');
    } catch (error) {
      setPageError(getApiError(error, 'failed to test all trunks'));
    } finally {
      setTestingAll(false);
    }
  };

  const handleOpenLadderFromTraffic = (callId: string) => {
    setLadderCallId(callId);
    setLadderFailedAt(undefined);
    setLadderError(undefined);
  };

  const handleOpenLadderFromFailure = async (failure: DiagnosticsFailureItem) => {
    let candidateCallId = (failure.callUuid || failure.callId || '').trim();

    if (!candidateCallId && failure.callerId && failure.time) {
      try {
        const history = await getDiagnosticsSipMessages(1, 200);
        const failedAtTime = Date.parse(failure.time);
        const match = history.data.find((message) => {
          if (!message.callId) {
            return false;
          }
          const timeDelta = Math.abs(Date.parse(message.timestamp) - failedAtTime);
          if (!Number.isFinite(timeDelta) || timeDelta > 300000) {
            return false;
          }
          const fromMatches = (message.fromUri || '').includes(failure.callerId || '');
          const toMatches = (message.toUri || '').includes(failure.callerId || '');
          return fromMatches || toMatches;
        });
        candidateCallId = match?.callId || '';
      } catch {
        candidateCallId = '';
      }
    }

    if (!candidateCallId) {
      return;
    }
    setLadderCallId(candidateCallId);
    setLadderFailedAt(failure.time || undefined);
    setLadderError(failure.errorMessage || undefined);
  };

  const actions = useMemo(() => (
    <button className={styles.refreshButton} onClick={() => {
      void refreshHealth();
      void refreshRegistrations();
      void refreshTrunks();
      void refreshFailures(failuresPage);
    }} type="button">
      Refresh
    </button>
  ), [failuresPage]);

  if (healthLoading && registrationsLoading && trunks.length === 0) {
    // No early return — skeletons render inline in each panel below
  }

  return (
    <PageLayout actions={actions} subtitle="monitor" title="Diagnostics">
      <div className={styles.page}>
        <ErrorMessage message={pageError} />
        {successText ? <div className={styles.successText}>{successText}</div> : null}

        {isHealthInitial ? (
          <section>
            <div style={{ display: 'flex', gap: 12, padding: '12px 0' }}>
              {[...Array(6)].map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </section>
        ) : healthError ? (
          <ErrorMessage message={healthError} />
        ) : (
          <SystemHealthPanel health={health} loading={healthLoading} />
        )}

        {isTrunksInitial ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '20%' },
                { width: '20%' },
                { width: '10%' },
                { width: '10%' },
                { width: '10%' },
                { width: '15%' },
                { width: '15%' },
              ]} />
            ))}
          </>
        ) : trunksError ? (
          <ErrorMessage message={trunksError} />
        ) : (
          <TrunkHealthPanel
            busyIds={busyIds}
            onTest={handleTestTrunk}
            onTestAll={handleTestAll}
            results={trunkResults}
            testingAll={testingAll}
            trunks={trunks}
          />
        )}

        {isRegistrationsInitial ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '15%' },
                { width: '10%' },
                { width: '15%' },
                { width: '25%' },
                { width: '10%' },
                { width: '25%' },
              ]} />
            ))}
          </>
        ) : registrationsError ? (
          <ErrorMessage message={registrationsError} />
        ) : (
          <SipRegistrationPanel items={registrations} loading={registrationsLoading} />
        )}

        <SipTrafficInspector items={traffic} loading={trafficLoading} onClear={() => setTraffic([])} onRowClick={handleOpenLadderFromTraffic} />

        {isFailuresInitial ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '15%' },
                { width: '15%' },
                { width: '20%' },
                { width: '15%' },
                { width: '20%' },
                { width: '15%' },
              ]} />
            ))}
          </>
        ) : failuresError ? (
          <ErrorMessage message={failuresError} />
        ) : (
          <CallFailuresPanel
            items={failures}
            onPageChange={setFailuresPage}
            page={failuresPage}
            totalPages={failureTotalPages}
            onTraceOpen={setTraceCallUuid}
            onFailureClick={handleOpenLadderFromFailure}
          />
        )}
      </div>

      <ExecutionTracePanel callUuid={traceCallUuid} onClose={() => setTraceCallUuid(null)} />
      {ladderCallId ? (
        <SipLadderPanel
          callId={ladderCallId}
          errorMessage={ladderError}
          failedAt={ladderFailedAt}
          onClose={() => setLadderCallId(null)}
        />
      ) : null}
    </PageLayout>
  );
}
