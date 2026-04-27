import { useCallback, useEffect, useRef, useState } from 'react';
import { getDiagnosticsResources } from '../../lib/api';
import { getApiError } from '../../lib/apiError';
import { formatBytes, formatDateTime } from '../../lib/time';
import type { DiagnosticsResourcesResponse } from '../../types';
import styles from './ResourcePanel.module.css';

const POLL_INTERVAL_MS = 5_000;
const ARC_RADIUS = 54;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_RADIUS;
// 270° arc: starts at bottom-left, ends at bottom-right
const ARC_OFFSET_FRAC = 0.25; // trim 25% (one quarter) = 90° hidden at bottom
const ARC_VISIBLE = ARC_CIRCUMFERENCE * (1 - ARC_OFFSET_FRAC);

function getCpuCoreCount(): number {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return navigator.hardwareConcurrency;
  }
  return 0;
}

function getThreshClass(pct: number): string {
  if (pct > 85) return styles.threshDanger;
  if (pct > 60) return styles.threshWarn;
  return styles.threshOk;
}

function MetricError() {
  return <div className={styles.metricError}>Failed to load</div>;
}

// ── CPU Arc Card ─────────────────────────────────────────────────────────────
interface CpuCardProps {
  data: DiagnosticsResourcesResponse['cpu'] | null;
}

function CpuCard({ data }: CpuCardProps) {
  const coreCount = getCpuCoreCount();

  if (data === null) {
    return (
      <div className={styles.skeletonCard}>
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '40%' }} />
        <div className={`${styles.skeletonCircleWrap}`}>
          <div className={`${styles.skeleton} ${styles.skeletonCircle}`} />
        </div>
      </div>
    );
  }

  if ('error' in data) {
    return (
      <div className={styles.card}>
        <div className={styles.cardLabel}>CPU</div>
        <MetricError />
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, data.usage));
  const threshClass = getThreshClass(pct);
  const filledLength = ARC_VISIBLE * (pct / 100);
  const dashOffset = ARC_VISIBLE - filledLength;
  // rotate so arc starts at bottom-left (-225deg)
  const svgSize = 140;
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  // Arc path: start angle = -225°, sweep 270°
  const startAngle = -225 * (Math.PI / 180);
  const startX = cx + ARC_RADIUS * Math.cos(startAngle);
  const startY = cy + ARC_RADIUS * Math.sin(startAngle);

  const endAngle = 45 * (Math.PI / 180);
  const endX = cx + ARC_RADIUS * Math.cos(endAngle);
  const endY = cy + ARC_RADIUS * Math.sin(endAngle);

  const arcPath = `M ${startX} ${startY} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${endX} ${endY}`;

  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>CPU</div>
      <div className={styles.cpuArcWrap}>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg
            className={`${styles.cpuArc} ${threshClass}`}
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            aria-hidden="true"
          >
            <path
              className={styles.arcTrack}
              d={arcPath}
              strokeWidth={10}
            />
            <path
              className={styles.arcFill}
              d={arcPath}
              strokeWidth={10}
              strokeDasharray={`${ARC_VISIBLE} ${ARC_CIRCUMFERENCE}`}
              strokeDashoffset={dashOffset}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <span className={`${styles.cpuValue} ${threshClass}`}>{pct.toFixed(1)}%</span>
            <span className={styles.cpuLabel}>CPU</span>
            {coreCount > 0 && (
              <span className={styles.cpuCores}>{coreCount} cores</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Memory Card ───────────────────────────────────────────────────────────────
interface MemoryCardProps {
  data: DiagnosticsResourcesResponse['memory'] | null;
}

function MemoryCard({ data }: MemoryCardProps) {
  if (data === null) {
    return (
      <div className={styles.skeletonCard}>
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '40%' }} />
        <div className={`${styles.skeleton} ${styles.skeletonBar}`} />
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '70%' }} />
      </div>
    );
  }

  if ('error' in data) {
    return (
      <div className={styles.card}>
        <div className={styles.cardLabel}>Memory</div>
        <MetricError />
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, data.usagePercent));
  const threshClass = getThreshClass(pct);

  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>Memory</div>
      <div className={styles.barWrap}>
        <span className={`${styles.barPercent} ${threshClass}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className={styles.bar}>
        <div
          className={`${styles.barFill} ${threshClass}`}
          style={{ width: `${pct}%`, ['--bar-fill' as string]: `var(--resource-${pct > 85 ? 'danger' : pct > 60 ? 'warn' : 'ok'})` }}
        />
      </div>
      <div className={styles.barStats}>
        <div className={styles.barStat}>
          <span className={styles.barStatValue}>{formatBytes(data.used)}</span>
          <span className={styles.barStatLabel}>used</span>
        </div>
        <div className={styles.barStat}>
          <span className={styles.barStatValue}>{formatBytes(data.free)}</span>
          <span className={styles.barStatLabel}>free</span>
        </div>
        <div className={styles.barStat}>
          <span className={styles.barStatValue}>{formatBytes(data.total)}</span>
          <span className={styles.barStatLabel}>total</span>
        </div>
      </div>
    </div>
  );
}

// ── Disk Card ─────────────────────────────────────────────────────────────────
interface DiskCardProps {
  data: DiagnosticsResourcesResponse['disk'] | null;
}

function DiskCard({ data }: DiskCardProps) {
  if (data === null) {
    return (
      <div className={styles.skeletonCard}>
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '30%' }} />
        <div className={`${styles.skeleton} ${styles.skeletonBar}`} />
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '70%' }} />
      </div>
    );
  }

  if ('error' in data) {
    return (
      <div className={styles.card}>
        <div className={styles.cardLabel}>Disk /</div>
        <MetricError />
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, data.usagePercent));
  const threshClass = getThreshClass(pct);

  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>Disk /</div>
      <div className={styles.barWrap}>
        <span className={`${styles.barPercent} ${threshClass}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className={styles.bar}>
        <div
          className={`${styles.barFill} ${threshClass}`}
          style={{ width: `${pct}%`, ['--bar-fill' as string]: `var(--resource-${pct > 85 ? 'danger' : pct > 60 ? 'warn' : 'ok'})` }}
        />
      </div>
      <div className={styles.barStats}>
        <div className={styles.barStat}>
          <span className={styles.barStatValue}>{formatBytes(data.used)}</span>
          <span className={styles.barStatLabel}>used</span>
        </div>
        <div className={styles.barStat}>
          <span className={styles.barStatValue}>{formatBytes(data.free)}</span>
          <span className={styles.barStatLabel}>free</span>
        </div>
        <div className={styles.barStat}>
          <span className={styles.barStatValue}>{formatBytes(data.total)}</span>
          <span className={styles.barStatLabel}>total</span>
        </div>
      </div>
    </div>
  );
}

// ── Asterisk Channels Card ────────────────────────────────────────────────────
interface AsteriskCardProps {
  data: DiagnosticsResourcesResponse['asterisk'] | null;
}

function AsteriskCard({ data }: AsteriskCardProps) {
  if (data === null) {
    return (
      <div className={styles.skeletonCard}>
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '60%' }} />
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '40%', height: '48px', marginTop: '8px' }} />
      </div>
    );
  }

  if ('error' in data) {
    return (
      <div className={styles.card}>
        <div className={styles.cardLabel}>Asterisk Channels</div>
        <MetricError />
      </div>
    );
  }

  const { activeChannels } = data;

  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>Asterisk Channels</div>
      <div className={styles.asteriskCenter}>
        <div className={styles.asteriskNumberRow}>
          <span className={styles.asteriskNumber}>{activeChannels}</span>
          {activeChannels > 0 && <span className={styles.pulseDot} aria-hidden="true" />}
        </div>
        <span className={styles.asteriskSubLabel}>active channels</span>
      </div>
    </div>
  );
}

// ── Network Card ──────────────────────────────────────────────────────────────
interface NetworkCardProps {
  data: DiagnosticsResourcesResponse['network'] | null;
}

function NetworkCard({ data }: NetworkCardProps) {
  if (data === null) {
    return (
      <div className={styles.skeletonCard}>
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '50%' }} />
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '70%', marginTop: '8px' }} />
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} style={{ width: '60%' }} />
      </div>
    );
  }

  if ('error' in data) {
    return (
      <div className={styles.card}>
        <div className={styles.networkHeader}>
          <span className={styles.cardLabel}>Network I/O</span>
          <span className={styles.networkSubtitle}>since boot</span>
        </div>
        <MetricError />
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.networkHeader}>
        <span className={styles.cardLabel}>Network I/O</span>
        <span className={styles.networkSubtitle}>since boot</span>
      </div>
      <div className={styles.networkRows}>
        <div className={styles.networkRow}>
          <span className={styles.arrowDown} aria-hidden="true">↓</span>
          <span className={styles.networkValue}>{formatBytes(data.bytesReceived)}</span>
          <span className={styles.networkRowLabel}>received</span>
        </div>
        <div className={styles.networkRow}>
          <span className={styles.arrowUp} aria-hidden="true">↑</span>
          <span className={styles.networkValue}>{formatBytes(data.bytesSent)}</span>
          <span className={styles.networkRowLabel}>sent</span>
        </div>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────
export function ResourcePanel() {
  const [data, setData] = useState<DiagnosticsResourcesResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await getDiagnosticsResources();
      setData(result);
      setLastUpdated(new Date());
      setFetchError(null);
    } catch (err) {
      setFetchError(getApiError(err, 'Failed to load resource metrics'));
    }
  }, []);

  useEffect(() => {
    void fetchData();
    pollTimerRef.current = setInterval(() => {
      void fetchData();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [fetchData]);

  const isLoading = data === null && fetchError === null;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>Resource Usage</h2>
        <div className={styles.panelMeta}>
          {!isLoading && <span className={styles.liveDot} aria-hidden="true" />}
          {lastUpdated && (
            <span className={styles.lastUpdated}>
              {formatDateTime(lastUpdated)}
            </span>
          )}
          {fetchError && (
            <span className={styles.lastUpdated} style={{ color: 'var(--color-error)' }}>
              {fetchError}
            </span>
          )}
          <button
            className={styles.refreshButton}
            onClick={() => { void fetchData(); }}
            type="button"
          >
            Refresh Now
          </button>
        </div>
      </div>

      <div className={styles.cardGrid}>
        <div className={styles.leftCol}>
          <CpuCard data={isLoading ? null : (data?.cpu ?? null)} />
          <MemoryCard data={isLoading ? null : (data?.memory ?? null)} />
        </div>
        <div className={styles.rightCol}>
          <DiskCard data={isLoading ? null : (data?.disk ?? null)} />
          <AsteriskCard data={isLoading ? null : (data?.asterisk ?? null)} />
          <NetworkCard data={isLoading ? null : (data?.network ?? null)} />
        </div>
      </div>
    </section>
  );
}
