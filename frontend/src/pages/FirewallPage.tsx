import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import {
  getFirewallConfig,
  getFirewallStats,
  listFirewallBlockedIps,
  listFirewallEvents,
  unblockFirewallIp,
  updateFirewallConfig,
  whitelistFirewallIp,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { diagnosticsSocket } from '../lib/socket';
import { formatDateTime } from '../lib/time';
import type { FirewallBlockedIp, FirewallConfig, FirewallFeedEvent, FirewallStats } from '../types';
import styles from './FirewallPage.module.css';

const FEED_LIMIT = 200;
const ARC_RADIUS = 44;
const ARC_SIZE = 120;
const ARC_PATH = `M 16 ${ARC_SIZE - 16} A ${ARC_RADIUS} ${ARC_RADIUS} 0 1 1 ${ARC_SIZE - 16} ${ARC_SIZE - 16}`;
const ARC_LENGTH = 210;

function emptyStats(): FirewallStats {
  return { totalBlockedToday: 0, totalAttemptsToday: 0, topIps: [], topCountries: [], hourly: Array.from({ length: 24 }, (_item, hour) => ({ hour, count: 0 })), trunks: [] };
}

function defaultConfig(): FirewallConfig {
  return { enforcementMode: 'iptables', threshold: 5, timeWindowSeconds: 300, blockDurationSeconds: 86400, trunkCeilings: {}, fail2banInstalled: false };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return 'permanent';
  if (seconds >= 86400) return `${Math.round(seconds / 86400)} day`;
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour`;
  return `${Math.round(seconds / 60)} min`;
}

function statusClass(eventType: FirewallFeedEvent['eventType']): string {
  if (eventType === 'blocked') return styles.feedBlocked;
  if (eventType === 'allowed') return styles.feedAllowed;
  return styles.feedWhitelist;
}

function heatClass(count: number, max: number, current: boolean): string {
  const intensity = max === 0 ? 0 : count / max;
  const level = intensity === 0 ? styles.heatZero : intensity < 0.34 ? styles.heatLow : intensity < 0.67 ? styles.heatMid : styles.heatHigh;
  return `${styles.heatCell} ${level} ${current ? styles.heatCurrent : ''}`;
}

function gaugeClass(pct: number): string {
  if (pct >= 80) return styles.gaugeDanger;
  if (pct >= 60) return styles.gaugeWarn;
  return styles.gaugeOk;
}

function SourceBar({ width, children }: { width: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.style.setProperty('--source-width', `${width}%`);
  }, [width]);
  return <div className={styles.sourceBar} ref={ref}>{children}</div>;
}

function Radar({ feed }: { feed: FirewallFeedEvent[] }) {
  const sweepRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const recent = feed.slice(-18).filter((event) => event.eventType === 'blocked');
  const regions = ['na', 'eu', 'asia', 'africa', 'sa', 'oceania'];

  useEffect(() => {
    const animate = (time: number) => {
      if (startRef.current === 0) startRef.current = time;
      const degrees = ((time - startRef.current) / 32) % 360;
      if (sweepRef.current) {
        sweepRef.current.style.transform = `rotate(${degrees}deg)`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div className={styles.radarDisc} aria-label="SIP attack radar">
      <div className={styles.radarGrid} />
      <div className={styles.sweep} ref={sweepRef} />
      {recent.map((event, index) => {
        const region = regions[Math.abs(event.countryCode.charCodeAt(0) + index) % regions.length];
        const fresh = index >= recent.length - 3;
        return <span className={`${styles.blip} ${styles[`region${region}`]} ${fresh ? styles.blipNew : styles.blipOld}`} key={`${event.createdAt}-${event.ip}`} />;
      })}
    </div>
  );
}

function TrunkGauge({ name, activeCalls, ceiling }: { name: string; activeCalls: number; ceiling: number }) {
  const pct = ceiling <= 0 ? 0 : Math.min(100, Math.round((activeCalls / ceiling) * 100));
  const dashOffset = ARC_LENGTH - (ARC_LENGTH * pct / 100);
  return (
    <div className={styles.gaugeCard}>
      <svg className={`${styles.gaugeSvg} ${gaugeClass(pct)}`} width={ARC_SIZE} height={ARC_SIZE} viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`} aria-hidden="true">
        <path className={styles.gaugeTrack} d={ARC_PATH} strokeWidth="10" />
        <path className={styles.gaugeFill} d={ARC_PATH} strokeDasharray={`${ARC_LENGTH} ${ARC_LENGTH}`} strokeDashoffset={dashOffset} strokeWidth="10" />
      </svg>
      <div className={styles.gaugeCenter}>
        <strong>{activeCalls}/{ceiling}</strong>
        <span>{name}</span>
      </div>
    </div>
  );
}

export function FirewallPage() {
  const [config, setConfig] = useState<FirewallConfig>(defaultConfig());
  const [stats, setStats] = useState<FirewallStats>(emptyStats());
  const [feed, setFeed] = useState<FirewallFeedEvent[]>([]);
  const [blocked, setBlocked] = useState<FirewallBlockedIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [whitelistValue, setWhitelistValue] = useState('');
  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedPausedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = (msg: string) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessText(msg);
    successTimerRef.current = setTimeout(() => setSuccessText(null), 3000);
  };

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [nextConfig, nextStats, nextBlocked, nextEvents] = await Promise.all([
        getFirewallConfig(),
        getFirewallStats(),
        listFirewallBlockedIps(),
        listFirewallEvents(1, FEED_LIMIT),
      ]);
      setConfig(nextConfig);
      setStats(nextStats);
      setBlocked(nextBlocked.data);
      setFeed([...nextEvents.data].reverse());
    } catch (err) {
      setError(getApiError(err, 'failed to load firewall'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleFeed = (event: FirewallFeedEvent) => {
      setFeed((current) => [...current, event].slice(-FEED_LIMIT));
      if (event.eventType === 'blocked') {
        void listFirewallBlockedIps().then((response) => setBlocked(response.data)).catch(() => undefined);
      }
    };
    const handleStats = (nextStats: FirewallStats) => setStats(nextStats);
    const subscribe = () => diagnosticsSocket.emit('firewall:subscribe');

    diagnosticsSocket.on('firewall:feed', handleFeed);
    diagnosticsSocket.on('firewall:stats', handleStats);
    diagnosticsSocket.on('connect', subscribe);
    if (diagnosticsSocket.connected) {
      subscribe();
    }

    return () => {
      diagnosticsSocket.emit('firewall:unsubscribe');
      diagnosticsSocket.off('connect', subscribe);
      diagnosticsSocket.off('firewall:feed', handleFeed);
      diagnosticsSocket.off('firewall:stats', handleStats);
    };
  }, []);

  useEffect(() => {
    if (!feedPausedRef.current && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [feed]);

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
    }
  }, []);

  const saveConfig = async (patch: Partial<FirewallConfig>) => {
    setError(null);
    try {
      const next = await updateFirewallConfig({
        enforcementMode: patch.enforcementMode,
        threshold: patch.threshold,
        timeWindowSeconds: patch.timeWindowSeconds,
        blockDurationSeconds: patch.blockDurationSeconds,
        trunkCeilings: patch.trunkCeilings,
      });
      setConfig(next);
      setSavedFlash(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSavedFlash(false), 900);
    } catch (err) {
      setError(getApiError(err, 'failed to save firewall config'));
    }
  };

  const handleUnblock = async (ip: string) => {
    try {
      await unblockFirewallIp(ip);
      setBlocked((current) => current.filter((item) => item.ip !== ip));
      showSuccess(`Unblocked ${ip}`);
    } catch (err) {
      setError(getApiError(err, 'failed to unblock address'));
    }
  };

  const handleWhitelist = async (ip: string) => {
    try {
      await whitelistFirewallIp(ip);
      setBlocked((current) => current.filter((item) => item.ip !== ip));
      showSuccess(`Whitelisted ${ip}`);
    } catch (err) {
      setError(getApiError(err, 'failed to whitelist address'));
    }
  };

  const addWhitelistTag = async () => {
    const value = whitelistValue.trim();
    if (!value) return;
    try {
      await whitelistFirewallIp(value);
      setWhitelistValue('');
      setSavedFlash(true);
      showSuccess(`Whitelisted ${value}`);
    } catch (err) {
      setError(getApiError(err, 'failed to add whitelist address'));
    }
  };

  const topMax = useMemo(() => Math.max(1, ...stats.topIps.map((item) => item.attemptCount)), [stats.topIps]);
  const heatMax = useMemo(() => Math.max(0, ...stats.hourly.map((item) => item.count)), [stats.hourly]);
  const currentHour = new Date().getHours();

  if (loading) {
    return <PageLayout title="SIP Firewall" subtitle="system"><Loading message="Loading firewall..." /></PageLayout>;
  }

  return (
    <PageLayout
      title="SIP Firewall"
      subtitle="system"
      actions={<button className={styles.refreshButton} type="button" onClick={() => void loadData()}>refresh</button>}
    >
      <div className={styles.page}>
        <ErrorMessage message={error} />
        {successText ? <div className={styles.successRibbon}>{successText}</div> : null}
        <section className={styles.statusBar}>
          <span className={styles.statusDot} />
          <span>mode <strong>{config.enforcementMode}</strong></span>
          <span>threshold <strong>{config.threshold}</strong></span>
          <span>window <strong>{Math.round(config.timeWindowSeconds / 60)}m</strong></span>
          <span>duration <strong>{formatDuration(config.blockDurationSeconds)}</strong></span>
          <button className={styles.secondaryButton} type="button" onClick={() => setDrawerOpen(true)}>settings</button>
        </section>

        <section className={styles.topGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>live feed</div>
            <div className={styles.feed} ref={feedRef} onMouseEnter={() => { feedPausedRef.current = true; }} onMouseLeave={() => { feedPausedRef.current = false; }}>
              {feed.length === 0 ? <div className={styles.emptyLine}>waiting for SIP security events</div> : null}
              {feed.map((event) => (
                <div className={`${styles.feedRow} ${statusClass(event.eventType)}`} key={`${event.createdAt}-${event.ip}-${event.detail}`}>
                  <span>{formatDateTime(event.createdAt)}</span>
                  <strong>{event.eventType}</strong>
                  <span>{event.ip} {event.reason}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={`${styles.panel} ${styles.radarPanel}`}>
            <div className={styles.blockedCounter}>{stats.totalBlockedToday}</div>
            <div className={styles.counterLabel}>blocked today</div>
            <Radar feed={feed} />
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>top sources</div>
            <div className={styles.sources}>
              {stats.topIps.map((item) => (
                <div className={styles.sourceRow} key={item.ip}>
                  <span>{item.countryCode}</span>
                  <strong>{item.ip}</strong>
                  <SourceBar width={(item.attemptCount / topMax) * 100}><span /></SourceBar>
                  <em>{item.attemptCount}</em>
                </div>
              ))}
              {stats.topIps.length === 0 ? <div className={styles.emptyLine}>no hostile sources yet</div> : null}
            </div>
          </div>
        </section>

        <section className={styles.midGrid}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>24 hour attempts</div>
            <div className={styles.heatmap}>
              {stats.hourly.map((item) => (
                <div className={heatClass(item.count, heatMax, item.hour === currentHour)} key={item.hour} title={`${item.hour}:00 - ${item.count} attempts`}>
                  <span>{item.hour}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>trunk protection</div>
            <div className={styles.gaugeGrid}>
              {stats.trunks.length === 0 ? <div className={styles.emptyLine}>no configured trunks</div> : null}
              {stats.trunks.map((trunk) => <TrunkGauge key={trunk.id} name={trunk.name} activeCalls={trunk.activeCalls} ceiling={trunk.ceiling} />)}
            </div>
          </div>
        </section>

        <section className={styles.blockedSection}>
          <div className={styles.panelHeader}>blocked addresses</div>
          {blocked.length === 0 ? <div className={styles.emptyState}>No blocked addresses</div> : null}
          <div className={styles.blockedGrid}>
            {blocked.map((item) => (
              <article className={styles.blockedCard} key={item.ip}>
                <div className={styles.blockedIp}>{item.ip}</div>
                <div className={styles.blockedCountry}>{item.countryName}</div>
                <div className={styles.blockedMeta}>attempts {item.attemptCount}</div>
                <div className={styles.blockedMeta}>blocked {formatDateTime(item.createdAt)}</div>
                <div className={styles.blockedMeta}>duration {item.expiresAt ? formatDateTime(item.expiresAt) : 'permanent'}</div>
                <div className={styles.cardActions}>
                  <button className={styles.whitelistButton} type="button" onClick={() => void handleWhitelist(item.ip)}>whitelist</button>
                  <button className={styles.unblockButton} type="button" onClick={() => void handleUnblock(item.ip)}>unblock</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      {drawerOpen ? (
        <div className={styles.drawerOverlay} role="presentation">
          <aside className={styles.drawer} aria-label="Firewall settings">
            <div className={styles.drawerHeader}>
              <div>
                <div className={styles.drawerEyebrow}>firewall settings</div>
                <h2>Protection rules</h2>
              </div>
              <button className={styles.drawerClose} type="button" onClick={() => setDrawerOpen(false)}>×</button>
            </div>
            <div className={`${styles.savedFlash} ${savedFlash ? styles.savedFlashActive : ''}`}>saved</div>
            <div className={styles.optionGrid}>
              {(['iptables', 'fail2ban'] as const).map((mode) => (
                <button className={`${styles.optionCard} ${config.enforcementMode === mode ? styles.optionCardActive : ''}`} type="button" key={mode} onClick={() => void saveConfig({ enforcementMode: mode })}>
                  <strong>{mode}</strong>
                  <span>{mode === 'iptables' ? 'local DROP rules, no service dependency' : 'host fail2ban jail integration'}</span>
                </button>
              ))}
            </div>
            {config.enforcementMode === 'fail2ban' && !config.fail2banInstalled ? <div className={styles.warningCard}>fail2ban-client was not detected on the host. iptables mode remains available.</div> : null}
            <label className={styles.sliderLabel}>auto-block threshold <strong>{config.threshold}</strong></label>
            <input className={styles.slider} type="range" min="1" max="20" value={config.threshold} onChange={(event) => void saveConfig({ threshold: Number(event.target.value) })} />
            <label className={styles.sliderLabel}>time window <strong>{Math.round(config.timeWindowSeconds / 60)} min</strong></label>
            <input className={styles.slider} type="range" min="1" max="60" value={Math.round(config.timeWindowSeconds / 60)} onChange={(event) => void saveConfig({ timeWindowSeconds: Number(event.target.value) * 60 })} />
            <div className={styles.durationButtons}>
              {[3600, 86400, null].map((value) => (
                <button className={`${styles.durationButton} ${config.blockDurationSeconds === value ? styles.durationActive : ''}`} type="button" key={String(value)} onClick={() => void saveConfig({ blockDurationSeconds: value })}>{formatDuration(value)}</button>
              ))}
            </div>
            <div className={styles.tagInputRow}>
              <input className={styles.input} value={whitelistValue} placeholder="whitelist IP" onChange={(event) => setWhitelistValue(event.target.value)} />
              <button className={styles.secondaryButton} type="button" onClick={() => void addWhitelistTag()}>add</button>
            </div>
            <div className={styles.trunkSettings}>
              {stats.trunks.map((trunk) => (
                <label key={trunk.id} className={styles.trunkInputLabel}>{trunk.name}
                  <input className={styles.input} type="number" min="1" defaultValue={trunk.ceiling} onBlur={(event) => void saveConfig({ trunkCeilings: { ...config.trunkCeilings, [String(trunk.id)]: Number(event.target.value) } })} />
                </label>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </PageLayout>
  );
}
