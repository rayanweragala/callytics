export type HealthBadgeState = 'healthy' | 'down' | 'degraded';

export interface DiagnosticsHealthItem {
  label: string;
  state: HealthBadgeState;
  detail: string;
}

export interface DiagnosticsSystemHealth {
  ari: {
    connected: boolean;
    latencyMs: number | null;
  };
  ami: {
    connected: boolean;
  };
  asterisk: {
    version: string | null;
    uptimeSeconds: number | null;
  };
  activeChannels: number;
  postgres: {
    reachable: boolean;
  };
  redis: {
    reachable: boolean;
  };
  items: DiagnosticsHealthItem[];
  checkedAt: string;
}

export interface TrunkDiagnosticsResult {
  trunkId: number;
  tcpStatus: 'reachable' | 'unreachable';
  tcpLatencyMs: number | null;
  sipStatus: 'reachable' | 'unreachable' | 'unknown';
  sipLatencyMs: number | null;
  status: 'reachable' | 'sip_unreachable' | 'unreachable' | 'unknown';
  message: string;
  testedAt: string;
}

export interface SipRegistrationRecord {
  name: string;
  type: 'extension' | 'trunk';
  status: 'registered' | 'unregistered' | 'unknown';
  contactUri: string | null;
  rttMs: number | null;
  lastSeen: string | null;
}

export interface RecentFailureRecord {
  id: number;
  callId: string;
  time: string;
  callerId: string | null;
  flowName: string | null;
  failedNodeType: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
}

export interface SipTrafficEvent {
  callId: string | null;
  timestamp: string;
  method: string;
  from: string;
  to: string;
  direction: 'inbound' | 'outbound';
  responseCode: number | null;
  rawMessage: string;
}

export interface SipMessage {
  id: number;
  callId: string | null;
  timestamp: string;
  method: string | null;
  fromUri: string | null;
  toUri: string | null;
  direction: string | null;
  responseCode: number | null;
  rawMessage: string | null;
  createdAt: string | null;
}

export interface CallEvent {
  callId: string;
  timestamp: string;
  type: 'started' | 'failed' | 'ended';
  caller: string;
  flowId?: number;
  failedNode?: string;
  failureReason?: string;
  durationSeconds?: number;
}

export interface AmiRegistrationDetail {
  endpoint: string;
  aor: string;
  contacts: string[];
  contactStatus?: string | null;
  roundtripUsec?: string | null;
  lastQualifiedAt?: string | null;
}
