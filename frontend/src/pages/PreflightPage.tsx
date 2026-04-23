import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { getPreflightHistory, runPreflightChecks } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { PreflightCheckResult, PreflightRun, PreflightStatus } from '../types';
import styles from './PreflightPage.module.css';

const CHECK_SKELETON: PreflightCheckResult[] = [
  { id: 'asterisk_ari', label: 'Asterisk ARI reachable', status: 'warn', message: '', detail: '' },
  { id: 'asterisk_ami', label: 'Asterisk AMI reachable', status: 'warn', message: '', detail: '' },
  { id: 'sip_port', label: 'SIP port 5080 listening', status: 'warn', message: '', detail: '' },
  { id: 'rtp_range', label: 'RTP port range bound', status: 'warn', message: '', detail: '' },
  { id: 'port_conflicts', label: 'Host port conflict check', status: 'warn', message: '', detail: '' },
  { id: 'postgres', label: 'PostgreSQL reachable', status: 'warn', message: '', detail: '' },
  { id: 'redis', label: 'Redis reachable', status: 'warn', message: '', detail: '' },
  { id: 'external_ip', label: 'External IP detection', status: 'warn', message: '', detail: '' },
  { id: 'nat_detected', label: 'NAT detection', status: 'warn', message: '', detail: '' },
  { id: 'stun', label: 'STUN reachability', status: 'warn', message: '', detail: '' },
  { id: 'disk_space', label: 'Disk space', status: 'warn', message: '', detail: '' },
  { id: 'sip_alg', label: 'SIP ALG (router setting)', status: 'warn', message: '', detail: '' },
];

export function PreflightPage() {
  const [history, setHistory] = useState<PreflightRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PreflightRun | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [autoRefreshStopped, setAutoRefreshStopped] = useState(false);
  const [expandedHistoryRunId, setExpandedHistoryRunId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const runs = await getPreflightHistory();
      setHistory(runs);
      if (!selectedRun && runs.length > 0) {
        setSelectedRun(runs[0]);
      }
    } catch (error) {
      setErrorText(getApiError(error, 'Failed to load preflight history'));
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedRun]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runChecks = useCallback(async () => {
    setErrorText(null);
    setRunning(true);
    setAutoRefreshStopped(false);
    setCountdown(null);
    try {
      const run = await runPreflightChecks();
      setSelectedRun(run);
      const runs = await getPreflightHistory();
      setHistory(runs);
    } catch (error) {
      setErrorText(getApiError(error, 'Failed to run preflight checks'));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRun || running || autoRefreshStopped) {
      setCountdown(null);
      return;
    }

    if (selectedRun.summary === 'warn' || selectedRun.summary === 'fail') {
      setCountdown(30);
      return;
    }

    setCountdown(null);
  }, [autoRefreshStopped, running, selectedRun]);

  useEffect(() => {
    if (countdown === null || running || autoRefreshStopped) {
      return;
    }

    if (countdown <= 0) {
      void runChecks();
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => (current === null ? current : current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoRefreshStopped, countdown, runChecks, running]);

  const results = useMemo(() => {
    if (!selectedRun) {
      return CHECK_SKELETON;
    }
    return selectedRun.checks;
  }, [selectedRun]);

  const summaryState: PreflightStatus | null = selectedRun ? selectedRun.summary : null;

  return (
    <PageLayout title="preflight wizard" subtitle="system">
      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div className={styles.headMeta}>
            Last run: {selectedRun ? formatDateTime(selectedRun.ranAt) : 'Never run'}
          </div>
          <div className={styles.actionsHeader}>
            <button className={styles.primaryButton} onClick={() => void runChecks()} disabled={running} type="button">
              {running ? 'running…' : 'run checks'}
            </button>
          </div>
        </div>

        {summaryState === 'pass' ? <div className={`${styles.summaryBanner} ${styles.summaryPass}`}>All checks passed. Your environment looks ready.</div> : null}
        {summaryState === 'warn' ? <div className={`${styles.summaryBanner} ${styles.summaryWarn}`}>Some warnings detected. Review the items below.</div> : null}
        {summaryState === 'fail' ? <div className={`${styles.summaryBanner} ${styles.summaryFail}`}>One or more checks failed. Review the issues below.</div> : null}

        {results.map((check) => {
          const status = selectedRun ? check.status : 'idle';
          const labelText = check.label && check.label.trim().length > 0 ? check.label : check.id;
          return (
            <div className={styles.row} key={check.id}>
              <div className={`${styles.statusIcon} ${running ? styles.pulse : ''}`}>
                {status === 'pass' ? <span className={styles.iconPass}>✓</span> : null}
                {status === 'warn' ? <span className={styles.iconWarn}>⚠</span> : null}
                {status === 'fail' ? <span className={styles.iconFail}>✕</span> : null}
                {status === 'idle' ? <span className={styles.iconIdle}>—</span> : null}
              </div>
              <div className={styles.checkLabel}>{labelText}</div>
              <div className={styles.checkMessage}>
                {check.message || 'Not run yet'}
                {check.detail ? <div className={styles.checkDetail}>{check.detail}</div> : null}
              </div>
            </div>
          );
        })}

        {countdown !== null && (summaryState === 'warn' || summaryState === 'fail') ? (
          <div className={styles.autoRefreshLine}>
            Re-checking in {countdown}s…{' '}
            <button className={styles.inlineLink} onClick={() => { setAutoRefreshStopped(true); setCountdown(null); }} type="button">
              stop auto-refresh
            </button>
          </div>
        ) : null}

        <ErrorMessage message={errorText} />
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div>Run history</div>
          <div className={styles.actionsHeader} />
        </div>

        {historyLoading ? (
          <Loading message="Loading history…" />
        ) : history.length === 0 ? (
          <div className={styles.empty}>No runs recorded yet. Click 'run checks' to start.</div>
        ) : (
          <>
            <div className={styles.historyHead}>
              <div>Timestamp</div>
              <div>Summary</div>
              <div className={styles.actionsHeader}>Details</div>
            </div>
            {history.map((run) => (
              <div key={run.id}>
                <div className={styles.historyRow}>
                  <div className={styles.timestamp}>{formatDateTime(run.ranAt)}</div>
                  <div>
                    <span className={`${styles.summaryBadge} ${run.summary === 'pass' ? styles.summaryBadgePass : ''} ${run.summary === 'warn' ? styles.summaryBadgeWarn : ''} ${run.summary === 'fail' ? styles.summaryBadgeFail : ''}`.trim()}>
                      {run.summary}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondaryButton}
                      onClick={() => setExpandedHistoryRunId((current) => (current === run.id ? null : run.id))}
                      type="button"
                    >
                      {expandedHistoryRunId === run.id ? 'hide' : 'view'}
                    </button>
                  </div>
                </div>
                {expandedHistoryRunId === run.id ? (
                  <div className={styles.historyDetails}>
                    {run.checks.map((check) => {
                      const labelText = check.label && check.label.trim().length > 0 ? check.label : check.id;
                      return (
                        <div className={styles.row} key={`${run.id}-${check.id}`}>
                          <div className={styles.statusIcon}>
                            {check.status === 'pass' ? <span className={styles.iconPass}>✓</span> : null}
                            {check.status === 'warn' ? <span className={styles.iconWarn}>⚠</span> : null}
                            {check.status === 'fail' ? <span className={styles.iconFail}>✕</span> : null}
                          </div>
                          <div className={styles.checkLabel}>{labelText}</div>
                          <div className={styles.checkMessage}>
                            {check.message}
                            {check.detail ? <div className={styles.checkDetail}>{check.detail}</div> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </>
        )}
      </div>
    </PageLayout>
  );
}
