import { useEffect, useRef, useState } from 'react';
// TEMP: uncomment after screenshot
/*
import {
  getDiagnosticsHealth,
  getDiagnosticsRegistrations,
  getDiagnosticsFailures,
  listCampaigns,
  getCampaignProgress,
  listQueues,
  listCallLogs,
} from '../lib/api';
import { diagnosticsSocket } from '../lib/socket';
import { getApiError } from '../lib/apiError';
*/
import type {
  DiagnosticsSystemHealth,
  RegistrationHealthResponse,
  DiagnosticsFailureItem,
  CampaignItem,
  QueueItem,
  CallTimelineEvent,
  CallEvent,
} from '../types';
import styles from './DashboardPage.module.css';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type WsStatus = 'connected' | 'reconnecting' | 'disconnected';

interface ActiveCallEntry {
  callId: string;
  caller: string;
  flowId: number | undefined;
  startedAt: number;
  currentNode: string;
  nodeType: string;
  events: CallTimelineEvent[];
}

interface CampaignProgress {
  status: string;
  totalContacts: number;
  dialedCount: number;
  answeredCount: number;
  failedCount: number;
  pendingCount: number;
  activeCallCount: number;
}

interface CallLogStats {
  today: number;
  answered: number;
  missed: number;
  avgDurationSecs: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(date: Date) {
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatElapsed(startTs: number): string {
  const diffMs = Date.now() - startTs;
  const totalSecs = Math.max(0, Math.floor(diffMs / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m === 0) return `${s}S AGO`;
  return `${m}M ${s}S AGO`;
}

function formatAvgDuration(secs: number | null): string {
  if (secs === null) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Derive call state label from the most recent node type */
function deriveState(nodeType: string): 'IN_IVR' | 'QUEUED' | 'BRIDGED' {
  const t = nodeType.toLowerCase();
  if (t.includes('queue')) return 'QUEUED';
  if (t.includes('transfer') || t.includes('bridge')) return 'BRIDGED';
  return 'IN_IVR';
}

/** Map DiagnosticsSystemHealth item label → display row.
 *  Matching is case-insensitive. */
function resolveHealthSignals(health: DiagnosticsSystemHealth | null): Array<{
  service: string;
  state: 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  signal: string;
}> {
  if (!health) return [];
  return health.items.map((item) => {
    let state: 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
    switch (item.state) {
      case 'healthy':
        state = 'OK';
        break;
      case 'degraded':
        state = 'DEGRADED';
        break;
      case 'down':
        state = 'DOWN';
        break;
      default:
        state = 'UNKNOWN';
    }
    return { service: item.label, state, signal: item.detail };
  });
}

/** Build a topology health map { serviceLabelLower → state } for coloring nodes */
function buildHealthMap(health: DiagnosticsSystemHealth | null): Map<string, 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'> {
  const map = new Map<string, 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'>();
  if (!health) return map;
  for (const item of health.items) {
    let state: 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
    switch (item.state) {
      case 'healthy':
        state = 'OK';
        break;
      case 'degraded':
        state = 'DEGRADED';
        break;
      case 'down':
        state = 'DOWN';
        break;
      default:
        state = 'UNKNOWN';
    }
    map.set(item.label.toLowerCase(), state);
  }
  // Also fold top-level fields for ARI/Asterisk in case items is sparse
  if (health.ari) {
    if (!map.has('ari')) {
      map.set('ari', health.ari.connected ? 'OK' : 'DOWN');
    }
  }
  if (health.postgres) {
    if (!map.has('db')) {
      map.set('db', health.postgres.reachable ? 'OK' : 'DOWN');
    }
  }
  if (health.redis) {
    if (!map.has('redis')) {
      map.set('redis', health.redis.reachable ? 'OK' : 'DOWN');
    }
  }
  return map;
}

/** Categorise a failure reason into a mix bucket */
function categorizeFail(reason: string | null): string {
  if (!reason) return 'other';
  const r = reason.toLowerCase();
  if (r.includes('trunk') || r.includes('sip') || r.includes('403') || r.includes('rejected')) return 'sip_trunk';
  if (r.includes('no_agent') || r.includes('queue')) return 'queue_capacity';
  if (r.includes('dtmf') || r.includes('asr') || r.includes('speech') || r.includes('input') || r.includes('timeout')) return 'caller_input';
  if (r.includes('ari')) return 'ari';
  return 'other';
}

/** Build failure mix array from recent failures, sorted desc by count */
function buildFailureMix(failures: DiagnosticsFailureItem[]): Array<{ label: string; count: number; pct: number }> {
  const counts = new Map<string, number>();
  for (const f of failures) {
    const bucket = categorizeFail(f.errorMessage);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const entries = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, pct: 0 }));
  const max = entries[0]?.count ?? 1;
  return entries.map((e) => ({ ...e, pct: Math.round((e.count / max) * 100) }));
}

/** Compute today's date range ISO strings */
function getTodayRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dateTo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return { dateFrom, dateTo };
}

const EMPTY_REGISTRATIONS: RegistrationHealthResponse = { extensions: [], trunks: [] };

// ---------------------------------------------------------------------------
// DashboardPage
// ---------------------------------------------------------------------------

export function DashboardPage() {
  // Clock
  const [currentTime, setCurrentTime] = useState(() => formatTime(new Date()));

  // WebSocket status
  const [wsStatus, setWsStatus] = useState<WsStatus>('connected');
  const [lastEventTs, setLastEventTs] = useState<number | null>(null);
  const [staleElapsed, setStaleElapsed] = useState('');

  // Active calls: keyed by callId
  const [activeCalls, setActiveCalls] = useState<Map<string, ActiveCallEntry>>(() => {
    const m = new Map<string, ActiveCallEntry>();
    const now = Date.now();
    const calls = [
      { callId: '1', caller: '+1 415 *** 0192', flowId: 'billing-main', duration: 3 * 60 + 42, node: 'collect_account_id', nodeType: 'ivr' },
      { callId: '2', caller: '+1 212 *** 8810', flowId: 'support-escalate', duration: 28, node: 'queue_support_l2', nodeType: 'queue' },
      { callId: '3', caller: '+44 20 *** 4102', flowId: 'outbound-renewal', duration: 6 * 60 + 19, node: 'agent_bridge', nodeType: 'bridge' },
      { callId: '4', caller: '+1 305 *** 2031', flowId: 'main-menu', duration: 1 * 60 + 7, node: 'route_sales', nodeType: 'ivr' },
      { callId: '5', caller: '+1 718 *** 4401', flowId: 'billing-main', duration: 52, node: 'payment_confirm', nodeType: 'ivr' },
    ];
    for (const c of calls) {
      m.set(c.callId, {
        callId: c.callId,
        caller: c.caller,
        flowId: c.flowId as any,
        startedAt: now - c.duration * 1000,
        currentNode: c.node,
        nodeType: c.nodeType,
        events: [],
      });
    }
    return m;
  });
  const [callTick, setCallTick] = useState(0);
  const [pressureHistory, setPressureHistory] = useState<number[]>(Array(16).fill(0));
  const [lastEndedTs, setLastEndedTs] = useState<number | null>(null);

  // Row interaction
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [flashedCallIds, setFlashedCallIds] = useState<Set<string>>(new Set());
  const flashTimers = useRef<Map<string, number>>(new Map());

  // REST data
  const [health, setHealth] = useState<DiagnosticsSystemHealth | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationHealthResponse>(() => ({
    trunks: [
      { trunkName: 'twilio-primary', host: '', status: 'registered', lastRegistration: '42ms', expiresIn: null },
      { trunkName: 'bandwidth-backup', host: '', status: 'registered', lastRegistration: '51ms', expiresIn: null },
      { trunkName: 'telnyx-eu', host: '', status: 'rejected' as any, lastRegistration: '403', expiresIn: null },
    ],
    extensions: [
      { extension: '1001', displayName: 'desk-01', status: 'registered', registeredIp: null, lastSeen: null, expiresIn: null },
      { extension: '1002', displayName: 'last 12m', status: 'unregistered', registeredIp: null, lastSeen: null, expiresIn: null },
      { extension: '1003', displayName: 'softphone', status: 'registered', registeredIp: null, lastSeen: null, expiresIn: null },
    ]
  } as any));
  const [failures, setFailures] = useState<DiagnosticsFailureItem[]>(() => [
    {
      id: 1,
      callId: 'fail-1',
      time: '14:02:11',
      callerId: '+1 646 ***8812',
      flowName: 'billing-main',
      failedNodeType: 'payment_confirm',
      errorMessage: 'dtmf_timeout',
      durationSeconds: 0,
    },
    {
      id: 2,
      callId: 'fail-2',
      time: '14:01:48',
      callerId: '+1 305 ***2031',
      flowName: 'support-escalate',
      failedNodeType: 'queue_support_l2',
      errorMessage: 'no_agents',
      durationSeconds: 0,
    },
    {
      id: 3,
      callId: 'fail-3',
      time: '14:00:19',
      callerId: '+44 20 ***7710',
      flowName: 'outbound-renewal',
      failedNodeType: 'dial_attempt',
      errorMessage: 'trunk_403',
      durationSeconds: 0,
    },
    {
      id: 4,
      callId: 'fail-4',
      time: '13:59:02',
      callerId: '+1 718 ***4401',
      flowName: 'main-menu',
      failedNodeType: 'speech_input',
      errorMessage: 'asr_no_match',
      durationSeconds: 0,
    },
  ] as any);
  const [callLogStats, setCallLogStats] = useState<CallLogStats | null>(() => ({
    today: 1284,
    answered: 1107,
    missed: 43,
    avgDurationSecs: 161,
  }));
  const [runningCampaign, setRunningCampaign] = useState<CampaignItem | null>(() => ({
    id: 1,
    name: 'outbound-renewal-q2',
    status: 'running',
    maxConcurrent: 12,
    maxRetries: 3,
    direction: 'outbound',
    description: '',
    config: {} as any,
    createdAt: '',
    updatedAt: '',
  } as any));
  const [campaignProgress, setCampaignProgress] = useState<CampaignProgress | null>(() => ({
    status: 'running',
    totalContacts: 12000,
    dialedCount: 8420,
    answeredCount: 2931,
    failedCount: 418,
    pendingCount: 3580,
    activeCallCount: 12,
  } as any));
  const queues = [
    { id: '1', name: 'priority', wait: '05', operatorCount: 1, pressure: '5.0x', fillClass: styles.queueFull, colorClass: styles.queuePressureHigh },
    { id: '2', name: 'support_l1', wait: '08', operatorCount: 4, pressure: '2.0x', fillClass: styles.queueMedium, colorClass: styles.queuePressureLive },
    { id: '3', name: 'sales', wait: '02', operatorCount: 3, pressure: '0.7x', fillClass: styles.queueLow, colorClass: styles.queuePressureLive },
    { id: '4', name: 'billing', wait: '00', operatorCount: 2, pressure: '0.0x', fillClass: styles.queueEmpty, colorClass: styles.queuePressureEmpty },
  ];

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const isStale = wsStatus === 'disconnected';

  const activeCallsArray = [...activeCalls.values()];
  const activeNow = 18;

  const failuresLast15m = 12;

  const healthSignals = [
    { service: 'Asterisk', state: 'OK' as const, signal: 'channels 18' },
    { service: 'ARI', state: 'OK' as const, signal: 'streaming' },
    { service: 'DB', state: 'OK' as const, signal: '8ms' },
    { service: 'Redis', state: 'WARN' as const, signal: '92ms' },
    { service: 'CPU', state: 'OK' as const, signal: '41%' },
    { service: 'Memory', state: 'WARN' as const, signal: '78%' },
  ];
  const healthMap = new Map<string, 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'>([
    ['pstn', 'OK'],
    ['sip', 'OK'],
    ['asterisk', 'OK'],
    ['ari', 'OK'],
    ['app', 'OK'],
    ['db', 'OK'],
    ['redis', 'WARN'],
  ]);
  const failureMix = buildFailureMix(failures);

  // ---------------------------------------------------------------------------
  // Flash helper
  // ---------------------------------------------------------------------------
  function flashCall(callId: string) {
    setFlashedCallIds((prev) => {
      const next = new Set(prev);
      next.add(callId);
      return next;
    });
    const existing = flashTimers.current.get(callId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      setFlashedCallIds((prev) => {
        const next = new Set(prev);
        next.delete(callId);
        return next;
      });
      flashTimers.current.delete(callId);
    }, 500);
    flashTimers.current.set(callId, timer);
  }

  // ---------------------------------------------------------------------------
  // Task 1 & 2 — WebSocket (call events + timeline)
  // ---------------------------------------------------------------------------
  // TEMP: uncomment after screenshot
  /*
  useEffect(() => {
    function handleConnect() {
      setWsStatus('connected');
      diagnosticsSocket.emit('call:subscribe');
    }

    function handleDisconnect() {
      setWsStatus('disconnected');
    }

    function handleReconnectAttempt() {
      setWsStatus('reconnecting');
    }

    function handleCallEvent(event: CallEvent) {
      setLastEventTs(Date.now());
      const { callId, caller, type, flowId } = event;

      if (type === 'started') {
        setActiveCalls((prev) => {
          const next = new Map(prev);
          next.set(callId, {
            callId,
            caller,
            flowId,
            startedAt: Date.now(),
            currentNode: '—',
            nodeType: '',
            events: [],
          });
          return next;
        });
        flashCall(callId);
      } else {
        // ended or failed
        setActiveCalls((prev) => {
          if (!prev.has(callId)) return prev;
          const next = new Map(prev);
          next.delete(callId);
          return next;
        });
        setLastEndedTs(Date.now());
      }
    }

    function handleCallTimeline(event: CallTimelineEvent) {
      setLastEventTs(Date.now());
      const { callId, nodeId, nodeType } = event;
      setActiveCalls((prev) => {
        if (!prev.has(callId)) return prev;
        const entry = prev.get(callId)!;
        const next = new Map(prev);
        next.set(callId, {
          ...entry,
          currentNode: nodeId,
          nodeType,
          events: [...entry.events, event],
        });
        return next;
      });
      flashCall(callId);
    }

    if (diagnosticsSocket.connected) {
      setWsStatus('connected');
      diagnosticsSocket.emit('call:subscribe');
    }

    diagnosticsSocket.on('connect', handleConnect);
    diagnosticsSocket.on('disconnect', handleDisconnect);
    diagnosticsSocket.on('reconnect_attempt', handleReconnectAttempt);
    diagnosticsSocket.on('call:event', handleCallEvent);
    diagnosticsSocket.on('call:timeline', handleCallTimeline);

    return () => {
      diagnosticsSocket.off('connect', handleConnect);
      diagnosticsSocket.off('disconnect', handleDisconnect);
      diagnosticsSocket.off('reconnect_attempt', handleReconnectAttempt);
      diagnosticsSocket.off('call:event', handleCallEvent);
      diagnosticsSocket.off('call:timeline', handleCallTimeline);
    };
  }, []);
  */

  // Cleanup flash timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of flashTimers.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Task 1 — Clock tick, stale elapsed, active count → pressure history
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(formatTime(new Date()));
      setCallTick((t) => t + 1);
      // Update stale elapsed
      if (lastEventTs !== null) {
        setStaleElapsed(formatElapsed(lastEventTs));
      }
      // Roll pressure history
      setActiveCalls((prev) => {
        setPressureHistory((hist) => {
          const next = [...hist.slice(1), prev.size];
          return next;
        });
        return prev;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [lastEventTs]);

  // ---------------------------------------------------------------------------
  // Task 4 — System health poll
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // TEMP: uncomment after screenshot
  // ---------------------------------------------------------------------------
  /*
  async function refreshHealth() {
    try {
      const result = await getDiagnosticsHealth();
      setHealth(result);
    } catch {
      // silently ignore — keep last known state
    }
  }

  // Task 5 — Registrations poll
  async function refreshRegistrations() {
    try {
      const result = await getDiagnosticsRegistrations();
      setRegistrations(result);
    } catch {
      // silently ignore
    }
  }

  // Task 8 — Failures poll
  async function refreshFailures() {
    try {
      const result = await getDiagnosticsFailures(10, 0);
      setFailures(result.data);
    } catch {
      // silently ignore
    }
  }

  // Task 3 — Call log stats poll
  async function refreshCallLogStats() {
    try {
      const { dateFrom, dateTo } = getTodayRange();
      const result = await listCallLogs({ dateFrom, dateTo, limit: 1000, page: 1 });
      const logs = result.data;
      const answered = logs.filter((l) => l.answeredAt !== null).length;
      const missed = logs.filter((l) => l.endReason === 'no_answer').length;
      const durSamples = logs
        .filter((l) => l.talkSeconds !== null && l.talkSeconds !== undefined)
        .map((l) => l.talkSeconds as number);
      const avgDurationSecs = durSamples.length > 0
        ? durSamples.reduce((a, b) => a + b, 0) / durSamples.length
        : null;
      setCallLogStats({ today: result.total, answered, missed, avgDurationSecs });
    } catch {
      // silently ignore
    }
  }

  // Task 6 — Campaign poll
  async function refreshCampaign() {
    try {
      const result = await listCampaigns(100, 0);
      const running = result.campaigns.find((c) => c.status === 'running') ?? null;
      setRunningCampaign(running);
      if (running) {
        const progress = await getCampaignProgress(running.id);
        setCampaignProgress(progress);
      } else {
        setCampaignProgress(null);
      }
    } catch {
      // silently ignore
    }
  }

  // Task 7 — Queues poll
  async function refreshQueues() {
    try {
      const result = await listQueues(1, 50);
      setQueues(result.data);
    } catch {
      // silently ignore
    }
  }

  // Initial load + polling intervals
  useEffect(() => {
    void refreshHealth();
    void refreshRegistrations();
    void refreshFailures();
    void refreshCallLogStats();
    void refreshCampaign();
    void refreshQueues();

    const healthTimer = window.setInterval(() => { void refreshHealth(); }, 15_000);
    const regTimer = window.setInterval(() => {
      void refreshRegistrations();
      void refreshFailures();
    }, 30_000);
    const callLogTimer = window.setInterval(() => { void refreshCallLogStats(); }, 60_000);
    const campaignTimer = window.setInterval(() => { void refreshCampaign(); }, 10_000);
    const queuesTimer = window.setInterval(() => { void refreshQueues(); }, 30_000);

    return () => {
      window.clearInterval(healthTimer);
      window.clearInterval(regTimer);
      window.clearInterval(callLogTimer);
      window.clearInterval(campaignTimer);
      window.clearInterval(queuesTimer);
    };
  }, []);
  */

  // ---------------------------------------------------------------------------
  // Summary strip metrics
  // ---------------------------------------------------------------------------
  const summaryMetrics = [
    {
      label: 'CALLS TODAY',
      value: '1,284',
      detail: 'TODAY',
    },
    {
      label: 'ANSWERED',
      value: '1,107',
      detail: '86.2% RATE',
    },
    {
      label: 'MISSED',
      value: '43',
      detail: '3.3% RATE',
    },
    {
      label: 'AVG DURATION',
      value: '02:41',
      detail: 'TODAY',
    },
    {
      label: 'ACTIVE NOW',
      value: '18',
      detail: wsStatus === 'connected' ? 'WS LIVE' : wsStatus === 'reconnecting' ? 'WS RECONNECTING' : 'WS OFFLINE',
    },
    {
      label: 'FAILURES',
      value: '12',
      detail: 'LAST 15M',
    },
  ];

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  function getActiveCallStateClass(state: 'IN_IVR' | 'QUEUED' | 'BRIDGED') {
    switch (state) {
      case 'BRIDGED': return styles.stateBridged;
      case 'QUEUED': return styles.stateQueued;
      case 'IN_IVR': return styles.stateIvr;
    }
  }

  function getHealthStateClass(state: 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN') {
    switch (state) {
      case 'OK': return styles.statusOk;
      case 'WARN': return styles.statusWarn;
      case 'DEGRADED': return styles.statusDegraded;
      case 'DOWN': return styles.statusDown;
      case 'UNKNOWN': return styles.statusUnknown;
    }
  }

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------
  return (
    <div className={styles.dashboard} data-stale={isStale ? 'true' : 'false'}>
      {/* Command Bar */}
      <header className={styles.commandBar}>
        <div className={styles.commandBrand}>CALLYTICS / LIVE</div>
        <div className={styles.commandStatus}>
          <span>WS</span>
          <span
            className={
              wsStatus === 'connected'
                ? styles.liveDot
                : wsStatus === 'reconnecting'
                ? styles.liveDotReconnecting
                : styles.liveDotDisconnected
            }
            aria-hidden="true"
          >
            ●
          </span>
          <span>
            {wsStatus === 'connected' ? 'CONNECTED' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'DISCONNECTED'}
          </span>
          <span className={styles.streamingLabel}>ARI STREAMING</span>
        </div>
        <div className={styles.commandContext}>
          <span>TODAY</span>
          <span>FLOW: ALL</span>
          <span className={styles.clock}>{currentTime}</span>
        </div>
      </header>

      {/* Stale banner */}
      {isStale ? (
        <div className={styles.staleBanner}>
          WS DISCONNECTED{staleElapsed ? ` · LAST EVENT ${staleElapsed}` : ''}
        </div>
      ) : null}

      {/* Summary strip */}
      <section className={styles.summaryStrip} aria-label="Live operations summary">
        {summaryMetrics.map((metric) => (
          <div className={styles.metricCell} key={metric.label}>
            <div className={styles.metricLabel}>{metric.label}</div>
            <div className={styles.metricValue}>{metric.value}</div>
            <div className={styles.metricDetail}>{metric.detail}</div>
          </div>
        ))}
      </section>

      <div className={styles.mainGrid}>
        {/* Active Calls */}
        <section className={`${styles.panel} ${styles.activeCallsPanel}`}>
          <PanelHeader
            title="ACTIVE CALLS"
            detail={`${activeNow} live · updated just now`}
          />

          <div className={styles.sparklineRow}>
            <div>
              <span className={styles.sparklineLabel}>CHANNEL PRESSURE</span>
              <span className={styles.sparklineCount}>{activeNow} ACTIVE</span>
            </div>
            <svg className={styles.sparkline} viewBox="0 0 120 24" role="img" aria-label="Channel pressure sparkline">
              {pressureHistory.map((height, index) => {
                const maxH = Math.max(...pressureHistory, 1);
                const scaled = Math.round((height / maxH) * 24);
                return (
                  <rect
                    className={styles.sparklineBar}
                    height={scaled}
                    key={index}
                    width="5"
                    x={index * 7}
                    y={24 - scaled}
                  />
                );
              })}
            </svg>
          </div>

          {/* callTick forces re-render each second for live duration */}
          {callTick >= 0 && activeCallsArray.length > 0 ? (
            <table className={styles.callsTable}>
              <thead>
                <tr>
                  <th>CALLER ID</th>
                  <th>DURATION</th>
                  <th>FLOW</th>
                  <th>CURRENT NODE</th>
                  <th>STATE</th>
                </tr>
              </thead>
              <tbody>
                {activeCallsArray.map((call) => {
                  const durationSecs = Math.floor((Date.now() - call.startedAt) / 1000);
                  const state = call.nodeType ? deriveState(call.nodeType) : 'IN_IVR';
                  const isExpanded = expandedCallId === call.callId;
                  const isFlashing = flashedCallIds.has(call.callId);
                  return (
                    <>
                      <tr
                        className={`${styles.callRow} table-row-hover ${durationSecs > 300 ? styles.rowHot : ''} ${isFlashing ? styles.rowFlash : ''}`}
                        key={call.callId}
                        onClick={() => setExpandedCallId(isExpanded ? null : call.callId)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className={styles.callerId}>{call.caller}</td>
                        <td className={styles.numeric}>{formatDuration(durationSecs)}</td>
                        <td className={styles.codeText}>
                          {typeof call.flowId === 'string' ? call.flowId : (call.flowId !== undefined ? `flow-${call.flowId}` : '—')}
                        </td>
                        <td className={styles.codeText}>{call.currentNode}</td>
                        <td>
                          <span className={`${styles.stateBadge} ${getActiveCallStateClass(state)}`}>
                            {state}
                          </span>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr key={`${call.callId}-trace`} className={styles.traceRow}>
                          <td colSpan={5}>
                            <div className={styles.tracePanel}>
                              <div className={styles.tracePanelTitle}>CALL TRACE — {call.callId}</div>
                              {call.events.length === 0 ? (
                                <span className={styles.tracePanelEmpty}>No timeline events received yet for this call.</span>
                              ) : (
                                <div className={styles.traceEventList}>
                                  {call.events.map((ev, i) => (
                                    <div className={styles.traceEvent} key={i}>
                                      <span className={styles.traceEventTs}>
                                        {new Date(ev.ts).toLocaleTimeString('en-GB', { hour12: false })}
                                      </span>
                                      <span className={styles.traceEventNode}>{ev.nodeId}</span>
                                      <span className={styles.traceEventType}>{ev.nodeType}</span>
                                      <span
                                        className={
                                          ev.status === 'error'
                                            ? styles.traceStatusError
                                            : ev.status === 'completed'
                                            ? styles.traceStatusOk
                                            : styles.traceStatusActive
                                        }
                                      >
                                        {ev.status}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className={styles.emptyState}>
              <div>NO ACTIVE CALLS</div>
              <span>
                {wsStatus === 'connected' ? 'WS: CONNECTED · ARI: IDLE' : 'WS: DISCONNECTED'}
                {lastEndedTs !== null ? ` · LAST CALL ENDED ${formatElapsed(lastEndedTs)}` : ''}
              </span>
            </div>
          )}
        </section>

        {/* System Health */}
        <section className={`${styles.panel} ${styles.systemHealthPanel}`}>
          <PanelHeader title="SYSTEM HEALTH" />
          <TopologySpine healthMap={healthMap} />
          <table className={styles.statusTable}>
            <thead>
              <tr>
                <th>SERVICE</th>
                <th>STATE</th>
                <th>SIGNAL</th>
              </tr>
            </thead>
            <tbody>
              {healthSignals.length === 0 ? (
                <tr>
                  <td className={styles.codeText} colSpan={3}>Loading…</td>
                </tr>
              ) : (
                healthSignals.map((item) => (
                  <tr className="table-row-hover" key={item.service}>
                    <td>{item.service}</td>
                    <td>
                      <span className={`${styles.statusText} ${getHealthStateClass(item.state)}`}>
                        {item.state}
                      </span>
                    </td>
                    <td className={styles.signalText}>{item.signal}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {/* Registrations */}
        <section className={`${styles.panel} ${styles.registrationsPanel}`}>
          <PanelHeader title="REGISTRATIONS" />
          <div className={styles.ledgerSection}>
            <div className={styles.sectionLabel}>TRUNKS</div>
            {registrations.trunks.length === 0 ? (
              <div className={styles.noCampaign}>No trunks configured</div>
            ) : (
              registrations.trunks.map((trunk) => {
                const isReg = trunk.status === 'registered';
                const isUnknown = trunk.status === 'unknown';
                return (
                  <div className={styles.registrationRow} key={trunk.trunkName}>
                    <span className={styles.registrationName}>{trunk.trunkName}</span>
                    <span
                      className={`${styles.signalBar} ${isReg ? styles.signalRegistered : styles.signalRejected}`}
                    />
                    <span className={isReg ? styles.registrationOk : styles.registrationWarn}>
                      {trunk.status}
                    </span>
                    <span className={styles.registrationSignal}>
                      {trunk.lastRegistration && (trunk.lastRegistration.includes('ms') || trunk.lastRegistration === '403')
                        ? trunk.lastRegistration
                        : (trunk.lastRegistration
                        ? (() => {
                            const diff = Math.max(0, Math.floor((Date.now() - Date.parse(trunk.lastRegistration)) / 1000));
                            if (diff < 60) return `${diff}s`;
                            if (diff < 3600) return `${Math.floor(diff / 60)}m`;
                            return `${Math.floor(diff / 3600)}h`;
                          })()
                        : isUnknown
                        ? '?'
                        : '—')}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div className={styles.ledgerSection}>
            <div className={styles.sectionLabel}>EXTENSIONS</div>
            {registrations.extensions.length === 0 ? (
              <div className={styles.noCampaign}>No extensions configured</div>
            ) : (
              registrations.extensions.map((ext) => {
                const isOnline = ext.status === 'registered';
                return (
                  <div
                    className={`${styles.extensionRow} ${!isOnline ? styles.extensionOffline : ''}`}
                    key={ext.extension}
                  >
                    <span>{ext.extension}</span>
                    <span className={isOnline ? styles.registrationOk : styles.registrationWarn}>
                      {isOnline ? 'online' : 'offline'}
                    </span>
                    <span>{ext.displayName ?? ext.registeredIp ?? '—'}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Campaign */}
        <section className={`${styles.panel} ${styles.campaignPanel}`}>
          <PanelHeader
            title="CAMPAIGN"
            detail={runningCampaign ? `${runningCampaign.name}    RUNNING` : undefined}
          />
          {!runningCampaign || !campaignProgress ? (
            <div className={styles.noCampaign}>NO ACTIVE CAMPAIGN</div>
          ) : (
            <>
              <div className={styles.progressList}>
                {/* DIALED */}
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>DIALED</span>
                  <span className={styles.progressTrack}>
                    <span
                      className={`${styles.progressFill} ${styles.progressDialed}`}
                      style={{ width: '70.1%' }}
                    />
                  </span>
                  <span className={styles.progressValue}>
                    8,420 / 12,000
                  </span>
                  <span className={styles.progressRate}>
                    70.1%
                  </span>
                </div>
                {/* ANSWERED */}
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>ANSWERED</span>
                  <span className={styles.progressTrack}>
                    <span
                      className={`${styles.progressFill} ${styles.progressAnswered}`}
                      style={{ width: '34.8%' }}
                    />
                  </span>
                  <span className={styles.progressValue}>
                    2,931
                  </span>
                  <span className={styles.progressRate}>
                    34.8%
                  </span>
                </div>
                {/* FAILED */}
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>FAILED</span>
                  <span className={styles.progressTrack}>
                    <span
                      className={`${styles.progressFill} ${styles.progressFailed}`}
                      style={{ width: '5.0%' }}
                    />
                  </span>
                  <span className={styles.progressValue}>
                    418
                  </span>
                  <span className={styles.progressRate}>
                    5.0%
                  </span>
                </div>
                {/* PENDING */}
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>PENDING</span>
                  <span className={styles.progressTrack}>
                    <span
                      className={`${styles.progressFill} ${styles.progressPending}`}
                      style={{ width: '29.8%' }}
                    />
                  </span>
                  <span className={styles.progressValue}>
                    3,580
                  </span>
                  <span className={styles.progressRate} />
                </div>
                {/* ACTIVE */}
                <div className={styles.progressRow}>
                  <span className={styles.progressLabel}>ACTIVE</span>
                  <span className={styles.progressTrack}>
                    <span
                      className={`${styles.progressFill} ${styles.progressAnswered}`}
                      style={{ width: '100%' }}
                    />
                  </span>
                  <span className={styles.progressValue}>12 calls now</span>
                  <span className={styles.progressRate} />
                </div>
              </div>
              <div className={styles.campaignMeta}>
                <span>dial rate&nbsp;&nbsp;42/min</span>
                <span>answer rate&nbsp;&nbsp;34.8%</span>
                <span>failure drift&nbsp;&nbsp;+1.2%</span>
              </div>
            </>
          )}
        </section>

        {/* Queues */}
        <section className={`${styles.panel} ${styles.queuesPanel}`}>
          <PanelHeader title="QUEUES" />
          {queues.length === 0 ? (
            <div className={styles.noCampaign}>NO QUEUES CONFIGURED</div>
          ) : (
            <div className={styles.queueList}>
              {queues.map((queue) => (
                <div className={styles.queueRow} key={queue.id}>
                  <div className={styles.queueLine}>
                    <span className={styles.queueName}>{queue.name}</span>
                    <div className={styles.queueStats}>
                      <span>wait {queue.wait}</span>
                      <span>agents {String(queue.operatorCount).padStart(2, '0')}</span>
                      <span>pressure {queue.pressure}</span>
                    </div>
                  </div>
                  <span className={styles.queueTrack}>
                    <span className={`${styles.queueFill} ${queue.fillClass} ${queue.colorClass}`} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Failures */}
        <section className={`${styles.panel} ${styles.failuresPanel}`}>
          <PanelHeader title="RECENT FAILURES" />
          <div className={styles.failuresContent}>
            <table className={styles.failuresTable}>
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>CALLER</th>
                  <th>FLOW</th>
                  <th>NODE</th>
                  <th>REASON</th>
                </tr>
              </thead>
              <tbody>
                {failures.length === 0 ? (
                  <tr>
                    <td className={styles.codeText} colSpan={5}>No failures recorded.</td>
                  </tr>
                ) : (
                  failures.slice(0, 4).map((failure, index) => {
                    const bucket = categorizeFail(failure.errorMessage);
                    const isPlatform = bucket === 'sip_trunk' || bucket === 'ari';
                    const timeStr = failure.time
                      ? new Date(failure.time).toLocaleTimeString('en-GB', { hour12: false })
                      : '—';
                    const rowId = failure.callId || String(index);
                    const isExpanded = expandedRowId === rowId;
                    return (
                      <>
                        <tr
                          className="table-row-hover"
                          key={rowId}
                          onClick={() => setExpandedRowId(isExpanded ? null : rowId)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className={styles.numeric}>{timeStr}</td>
                          <td className={styles.callerId}>{failure.callerId ?? '—'}</td>
                          <td className={styles.codeText}>{failure.flowName ?? '—'}</td>
                          <td className={styles.codeText}>{failure.failedNodeType ?? '—'}</td>
                          <td className={isPlatform ? styles.reasonPlatform : styles.reasonRecoverable}>
                            {failure.errorMessage ?? '—'}
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className={styles.failureTraceRow} key={`${rowId}-expand`}>
                            <td colSpan={5}>
                              <div className={styles.failureTracePanel}>
                                <div className={styles.failureTraceGrid}>
                                  <div className={styles.failureTraceField}>
                                    <span className={styles.failureTraceLabel}>TIME</span>
                                    <span className={styles.failureTraceValue}>
                                      {failure.time && failure.time.includes(':')
                                        ? `2026-05-24 ${failure.time}`
                                        : (failure.time
                                        ? new Date(failure.time).toLocaleString('en-GB', { hour12: false })
                                        : '—')}
                                    </span>
                                  </div>
                                  <div className={styles.failureTraceField}>
                                    <span className={styles.failureTraceLabel}>CALLER</span>
                                    <span className={styles.failureTraceValue}>{failure.callerId ?? '—'}</span>
                                  </div>
                                  <div className={styles.failureTraceField}>
                                    <span className={styles.failureTraceLabel}>FLOW</span>
                                    <span className={styles.failureTraceValue}>{failure.flowName ?? '—'}</span>
                                  </div>
                                  <div className={styles.failureTraceField}>
                                    <span className={styles.failureTraceLabel}>NODE</span>
                                    <span className={styles.failureTraceValue}>{failure.failedNodeType ?? '—'}</span>
                                  </div>
                                  <div className={styles.failureTraceField}>
                                    <span className={styles.failureTraceLabel}>REASON</span>
                                    <span className={styles.failureTraceValue}>{failure.errorMessage ?? '—'}</span>
                                  </div>
                                  {failure.callId ? (
                                    <div className={styles.failureTraceField}>
                                      <span className={styles.failureTraceLabel}>CALL ID</span>
                                      <span className={styles.failureTraceValue}>{failure.callId}</span>
                                    </div>
                                  ) : null}
                                  {failure.durationSeconds !== null && failure.durationSeconds !== undefined ? (
                                    <div className={styles.failureTraceField}>
                                      <span className={styles.failureTraceLabel}>DURATION</span>
                                      <span className={styles.failureTraceValue}>{formatDuration(failure.durationSeconds)}</span>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </>
                    );
                  })
                )}
              </tbody>
            </table>

            <div className={styles.failureMix}>
              <div className={styles.mixTitle}>FAILURE MIX / 15M</div>
              {failureMix.length === 0 ? (
                <div className={styles.noCampaign}>No failures</div>
              ) : (
                failureMix.map((item) => (
                  <div className={styles.mixRow} key={item.label}>
                    <span>{item.label}</span>
                    <span className={styles.mixCount}>{item.count}</span>
                    <span className={styles.mixTrack}>
                      <span
                        className={styles.mixFill}
                        style={{ width: `${item.pct}%` }}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PanelHeader
// ---------------------------------------------------------------------------

function PanelHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className={styles.panelHeader}>
      <h2>{title}</h2>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TopologySpine — data-driven, receives healthMap from parent
// ---------------------------------------------------------------------------

interface TopologySpineProps {
  healthMap: Map<string, 'OK' | 'WARN' | 'DEGRADED' | 'DOWN' | 'UNKNOWN'>;
}

function TopologySpine({ healthMap }: TopologySpineProps) {
  function nodeClass(label: string): string {
    const state = healthMap.get(label.toLowerCase());
    switch (state) {
      case 'WARN':
      case 'DEGRADED':
        return styles.topologyNodeWarn;
      case 'DOWN':
        return styles.topologyNodeDown;
      default:
        return styles.topologyNodeOk;
    }
  }

  return (
    <svg
      className={styles.topology}
      viewBox="0 0 360 96"
      role="img"
      aria-label="PSTN to SIP to Asterisk to ARI to App to DB and Redis topology"
    >
      {/* Static connector lines */}
      <path className={styles.topologyLine} d="M76 27H108" />
      <path className={styles.topologyLine} d="M164 27H196" />
      <path className={styles.topologyLine} d="M224 38 L224 48 L48 48 L48 58" />
      <path className={styles.topologyLine} d="M76 69H108" />
      <path className={styles.topologyLine} d="M164 69H196" />
      <path className={styles.topologyLine} d="M252 69H284" />

      {/* Animated flow lines */}
      <path className={styles.topologyFlowLine} d="M76 27H108" />
      <path className={styles.topologyFlowLine} d="M164 27H196" />
      <path className={styles.topologyFlowLine} d="M224 38 L224 48 L48 48 L48 58" />
      <path className={styles.topologyFlowLine} d="M76 69H108" />
      <path className={styles.topologyFlowLine} d="M164 69H196" />
      <path className={styles.topologyFlowLine} d="M252 69H284" />

      {[
        { label: 'PSTN', x: 20, y: 16 },
        { label: 'SIP', x: 108, y: 16 },
        { label: 'ASTERISK', x: 196, y: 16 },
        { label: 'ARI', x: 20, y: 58 },
        { label: 'APP', x: 108, y: 58 },
        { label: 'DB', x: 196, y: 58 },
        { label: 'REDIS', x: 284, y: 58 },
      ].map((node) => (
        <g key={node.label}>
          <rect className={nodeClass(node.label)} x={node.x} y={node.y} width="56" height="22" />
          <text className={styles.topologyText} x={node.x + 28} y={node.y + 14}>
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
