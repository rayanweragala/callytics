import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CallQuality } from '../../types';
import { getCallQuality } from '../../lib/api';
import { jitterLabel, mosVerdict, packetLossLabel, rttLabel } from '../../lib/mosLabel';
import { Loading } from '../common/Loading';
import { MosGauge } from './MosGauge';
import styles from './QualityDrawer.module.css';

interface QualityDrawerProps {
  callId: string | null;
  onClose: () => void;
}

function gradeClass(grade: 'good' | 'fair' | 'poor'): string {
  if (grade === 'good') return styles.good;
  if (grade === 'fair') return styles.fair;
  return styles.poor;
}

export function QualityDrawer({ callId, onClose }: QualityDrawerProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [quality, setQuality] = useState<CallQuality | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!callId) {
        setQuality(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const result = await getCallQuality(callId);
      if (!active) {
        return;
      }

      setQuality(result);
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [callId]);

  const isOpen = Boolean(callId);
  const verdict = useMemo(() => {
    if (!quality) return '';
    return mosVerdict(quality.mos, quality.jitter, quality.packetLoss);
  }, [quality]);

  return (
    <aside className={`${styles.panel} ${isOpen ? styles.open : ''}`} aria-hidden={!isOpen}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>Call Quality</h2>
        <button className={styles.closeButton} onClick={onClose} type="button">×</button>
      </div>

      {loading ? <Loading message="Loading quality..." /> : null}

      {!loading && isOpen && !quality ? (
        <div className={styles.empty}>No quality data available for this call.</div>
      ) : null}

      {!loading && quality ? (
        <div className={styles.content}>
          <div className={styles.scoreWrap}>
            <div className={`${styles.score} ${gradeClass(quality.grade)}`}>{quality.mos.toFixed(2)}</div>
            <div className={`${styles.grade} ${gradeClass(quality.grade)}`}>{quality.grade}</div>
          </div>

          <p className={styles.verdict}>{verdict}</p>

          <div className={styles.gauges}>
            <MosGauge
              label="Jitter"
              value={quality.jitter}
              unit="ms"
              plainLabel={jitterLabel(quality.jitter)}
              fillPct={Math.min(100, (quality.jitter / 100) * 100)}
              grade={quality.grade}
            />
            <MosGauge
              label="Packet Loss"
              value={quality.packetLoss}
              unit="%"
              plainLabel={packetLossLabel(quality.packetLoss)}
              fillPct={Math.min(100, quality.packetLoss * 20)}
              grade={quality.grade}
            />
            <MosGauge
              label="RTT"
              value={quality.rtt}
              unit="ms"
              plainLabel={rttLabel(quality.rtt)}
              fillPct={Math.min(100, (quality.rtt / 300) * 100)}
              grade={quality.grade}
            />
          </div>

          <button
            className={styles.captureButton}
            onClick={() => {
              if (!callId) return;
              onClose();
              navigate(`/capture?callId=${encodeURIComponent(callId)}`);
            }}
            type="button"
          >
            View in Capture
          </button>
        </div>
      ) : null}
    </aside>
  );
}
