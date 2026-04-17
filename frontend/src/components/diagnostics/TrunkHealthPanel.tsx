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

export function TrunkHealthPanel({
  trunks,
  results,
  busyIds,
  testingAll,
  onTest,
  onTestAll,
}: TrunkHealthPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Panel B</div>
          <h2 className={styles.title}>Trunk Health</h2>
        </div>
        <button className={styles.button} disabled={testingAll || trunks.length === 0} onClick={onTestAll} type="button">
          {testingAll ? 'Testing...' : 'Test All'}
        </button>
      </div>

      <div className={styles.table}>
        <div className={styles.head}>
          <span>Trunk</span>
          <span>Host</span>
          <span>TCP</span>
          <span>SIP</span>
          <span>RTT</span>
          <span>Last Tested</span>
          <span>Action</span>
        </div>
        {trunks.map((trunk) => {
          const result = results[trunk.id];
          const busy = busyIds.includes(trunk.id);
          return (
            <div className={styles.row} key={trunk.id}>
              <span className={styles.name}>{trunk.name}</span>
              <span>{trunk.host}:{trunk.port}</span>
              <span>{result?.tcpStatus || 'unknown'}</span>
              <span>
                <span className={`${styles.badge} ${styles[result?.status || 'unknown']}`}>
                  {getStatusLabel(result)}
                </span>
              </span>
              <span className={styles.mono}>{result?.sipLatencyMs ?? result?.tcpLatencyMs ?? '—'}</span>
              <span>{result ? formatDateTime(result.testedAt) : 'Never'}</span>
              <span>
                <button className={styles.button} disabled={busy || testingAll} onClick={() => onTest(trunk.id)} type="button">
                  {busy ? 'Testing...' : 'Test Now'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
