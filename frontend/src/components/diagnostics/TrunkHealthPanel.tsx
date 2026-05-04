import { Fragment, useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/time';
import type { SipTrunkItem, TrunkDiagnosticsResult } from '../../types';
import styles from './TrunkHealthPanel.module.css';

interface TrunkHealthPanelProps {
  trunks: SipTrunkItem[];
  results: Record<number, TrunkDiagnosticsResult>;
  busyIds: number[];
  testingAll: boolean;
  onTest: (id: number) => void;
  onTestAll: () => void;
}

function getStatusLabel(result?: TrunkDiagnosticsResult): string {
  if (!result) {
    return 'Unknown';
  }
  if (result.status === 'reachable') {
    return 'Reachable';
  }
  if (result.status === 'sip_unreachable') {
    return 'SIP Unreachable';
  }
  if (result.status === 'unreachable') {
    return 'Unreachable';
  }
  return 'Unknown';
}

function extractSipCode(result: TrunkDiagnosticsResult): number {
  return result.sipCode;
}

function codeClass(code: number): string {
  if (code >= 200 && code < 300) {
    return styles.codeSuccess;
  }
  if (code >= 400 && code < 500) {
    return styles.codeWarning;
  }
  if (code >= 500) {
    return styles.codeError;
  }
  return styles.codeNeutral;
}

function codecDisplay(name: string): string {
  if (name === 'PCMU') {
    return 'G.711 μ-law';
  }
  if (name === 'PCMA') {
    return 'G.711 A-law';
  }
  if (name === 'G722') {
    return 'G.722 Wideband';
  }
  if (name === 'G729') {
    return 'G.729';
  }
  if (name.toLowerCase() === 'opus') {
    return 'Opus';
  }
  if (name.toLowerCase() === 'telephone-event') {
    return 'DTMF (RFC 2833)';
  }
  return name;
}

export function TrunkHealthPanel({
  trunks,
  results,
  busyIds,
  testingAll,
  onTest,
  onTestAll,
}: TrunkHealthPanelProps) {
  const [openTrunkId, setOpenTrunkId] = useState<number | null>(null);
  const [pendingOpenId, setPendingOpenId] = useState<number | null>(null);

  useEffect(() => {
    if (pendingOpenId !== null && results[pendingOpenId]) {
      setOpenTrunkId(pendingOpenId);
      setPendingOpenId(null);
    }
  }, [pendingOpenId, results]);

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Trunk Health</h2>
        </div>
        <button className={styles.button} disabled={testingAll || trunks.length === 0} onClick={onTestAll} type="button">
          {testingAll ? 'Testing...' : 'Test All'}
        </button>
      </div>

      <div className={styles.tableCard}>
        <table>
          <thead>
            <tr>
              <th>Trunk</th>
              <th>Host</th>
              <th>TCP</th>
              <th>SIP</th>
              <th>RTT</th>
              <th>Last Tested</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {trunks.length === 0 ? (
              <tr><td colSpan={7} className={styles.emptyState}>No trunks configured.</td></tr>
            ) : (
              trunks.map((trunk) => {
                const result = results[trunk.id];
                const busy = busyIds.includes(trunk.id);
                const open = openTrunkId === trunk.id && Boolean(result);
                return (
                  <Fragment key={trunk.id}>
                    <tr>
                      <td className={styles.name}>{trunk.name}</td>
                      <td className={styles.hostCell} title={`${trunk.host}:${trunk.port}`}>{trunk.host}:{trunk.port}</td>
                      <td className={styles.tcpCell}>{result?.tcpStatus || 'unknown'}</td>
                      <td>
                        <span className={`${styles.badge} ${styles[result?.status || 'unknown']}`}>
                          {getStatusLabel(result)}
                        </span>
                      </td>
                      <td className={styles.mono}>{result?.sipLatencyMs ?? result?.tcpLatencyMs ?? '—'}</td>
                      <td>{result ? formatDateTime(result.testedAt) : 'Never'}</td>
                      <td>
                        <button
                          className={styles.button}
                          disabled={busy || testingAll}
                          onClick={() => {
                            if (open) {
                              setOpenTrunkId(null);
                              return;
                            }
                            setPendingOpenId(trunk.id);
                            onTest(trunk.id);
                          }}
                          type="button"
                        >
                          {busy ? 'Testing...' : 'Test Now'}
                        </button>
                      </td>
                    </tr>
                    {open && result ? (
                      <tr>
                        <td className={styles.detailCell} colSpan={7}>
                          <div className={styles.detailPanel}>
                            <div className={styles.statusLine}>
                              <span className={`${styles.codeBadge} ${codeClass(extractSipCode(result))}`}>{extractSipCode(result)}</span>
                              <span>{result.sipCodeTitle} — {result.sipCodeExplanation}</span>
                            </div>
                            <div className={styles.rttLine}>Response time: <span>{result.sipLatencyMs ?? result.tcpLatencyMs ?? '—'}ms</span></div>
                            <div className={styles.codecLine}>
                              <span>Supported codecs:</span>
                              {result.codecsSupported.length > 0 ? (
                                <div className={styles.codecPills}>
                                  {result.codecsSupported.map((codec) => <span className={styles.codecPill} key={codec}>{codecDisplay(codec)}</span>)}
                                </div>
                              ) : (
                                <span className={styles.mutedText}>Codec list not advertised in OPTIONS response</span>
                              )}
                            </div>
                            <details className={styles.rawBlock}>
                              <summary>OPTIONS sent →</summary>
                              {result.rawCaptureAvailable ? <pre>{result.rawOptionsSent}</pre> : <div className={styles.rawUnavailable}>Start live capture to see raw exchange</div>}
                            </details>
                            <details className={styles.rawBlock}>
                              <summary>Response received ←</summary>
                              {result.rawCaptureAvailable ? <pre>{result.rawOptionsResponse}</pre> : <div className={styles.rawUnavailable}>Start live capture to see raw exchange</div>}
                            </details>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
