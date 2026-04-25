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
                return (
                  <tr key={trunk.id}>
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
                      <button className={styles.button} disabled={busy || testingAll} onClick={() => onTest(trunk.id)} type="button">
                        {busy ? 'Testing...' : 'Test Now'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
