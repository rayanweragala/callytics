import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CallQuality } from '../../types';
import { getCallQuality } from '../../lib/api';
import { jitterLabel, mosVerdict, packetLossLabel, rttLabel } from '../../lib/mosLabel';
import { Loading } from '../common/Loading';
import styles from './QualityDrawer.module.css';

interface QualityDrawerProps {
  callId: string | null;
  onClose: () => void;
}

function metricClass(grade: 'good' | 'fair' | 'poor'): string {
  if (grade === 'good') return styles.metricGood;
  if (grade === 'fair') return styles.metricFair;
  return styles.metricPoor;
}

function metricGrade(value: number, goodMax: number, fairMax: number): 'good' | 'fair' | 'poor' {
  if (value <= goodMax) return 'good';
  if (value <= fairMax) return 'fair';
  return 'poor';
}

export function QualityDrawer({ callId, onClose }: QualityDrawerProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [quality, setQuality] = useState<CallQuality | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!callId) {
        setQuality(null);
        setErrorText(null);
        setLoading(false);
        return;
      }

      setErrorText(null);
      setLoading(true);
      try {
        const result = await getCallQuality(callId);
        if (!active) {
          return;
        }
        setQuality(result);
      } catch {
        if (!active) {
          return;
        }
        setQuality(null);
        setErrorText('Failed to load call quality.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
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

  const metrics = useMemo(() => {
    if (!quality) return [];
    return [
      {
        label: 'Jitter',
        value: quality.jitter,
        unit: 'ms',
        plainLabel: jitterLabel(quality.jitter),
        fillPct: Math.min(100, (quality.jitter / 100) * 100),
        grade: metricGrade(quality.jitter, 20, 50),
      },
      {
        label: 'Packet Loss',
        value: quality.packetLoss,
        unit: '%',
        plainLabel: packetLossLabel(quality.packetLoss),
        fillPct: Math.min(100, quality.packetLoss * 20),
        grade: metricGrade(quality.packetLoss, 1, 3),
      },
      {
        label: 'RTT',
        value: quality.rtt,
        unit: 'ms',
        plainLabel: rttLabel(quality.rtt),
        fillPct: Math.min(100, (quality.rtt / 300) * 100),
        grade: metricGrade(quality.rtt, 120, 200),
      },
    ];
  }, [quality]);

  return (
    <aside className={`${styles.panel} ${isOpen ? styles.open : ''}`} aria-hidden={!isOpen}>
      <div className={styles.header}>
        <div className={styles.title}>Call Quality</div>
        <button className={styles.closeButton} onClick={onClose} type="button" aria-label="Close call quality">×</button>
      </div>

      <div className={styles.body}>
        {loading ? <Loading message="Loading quality..." /> : null}

        {!loading && errorText ? (
          <div className={styles.empty}>{errorText}</div>
        ) : null}

        {!loading && !errorText && isOpen && !quality ? (
          <div className={styles.empty}>No quality data available for this call.</div>
        ) : null}

        {!loading && quality ? (
          <div className={styles.content}>
            <div className={styles.scoreWrap}>
              <div className={styles.score}>{quality.mos.toFixed(2)}</div>
              <div className={styles.qualityLabelWrap}>
                <span className={styles.grade}>{quality.grade}</span>
                <span className={styles.gradeMuted}>quality</span>
              </div>
            </div>

            <p className={styles.verdict}>{verdict}</p>

            <div className={styles.metrics}>
              {metrics.map((metric) => (
                <article className={styles.metricCard} key={metric.label}>
                  <div className={styles.metricRow}>
                    <span className={styles.metricLabel}>{metric.label}</span>
                    <span className={styles.metricValue}>
                      {metric.value}
                      {metric.unit}
                    </span>
                  </div>
                  <div className={styles.metricPlain}>{metric.plainLabel}</div>
                  <div className={styles.metricTrack}>
                    <div
                      className={`${styles.metricFill} ${metricClass(metric.grade)}`}
                      style={{ ['--bar-width' as string]: `${metric.fillPct}%` }}
                    />
                  </div>
                </article>
              ))}
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
      </div>
    </aside>
  );
}
