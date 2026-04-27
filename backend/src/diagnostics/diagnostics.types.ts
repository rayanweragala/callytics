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
  sipCode: number;
  sipCodeTitle: string;
  sipCodeExplanation: string;
  rawOptionsSent: string;
  rawOptionsResponse: string;
  rawCaptureAvailable: boolean;
  codecsSupported: string[];
}

export interface RegistrationExtensionRecord {
  extension: string;
  displayName: string;
  status: 'registered' | 'unregistered';
  registeredIp: string | null;
  lastSeen: string | null;
  expiresIn: number | null;
}

export interface RegistrationTrunkRecord {
  trunkName: string;
  host: string;
  status: 'registered' | 'unregistered' | 'unknown';
  lastRegistration: string | null;
  expiresIn: number | null;
}

export interface RegistrationHealthResponse {
  extensions: RegistrationExtensionRecord[];
  trunks: RegistrationTrunkRecord[];
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

export interface CallTimelineEvent {
  callId: string;
  flowId: number;
  nodeId: string;
  nodeType: string;
  status: 'started' | 'completed' | 'error';
  ts: number;
  meta: Record<string, unknown>;
}

export interface AmiRegistrationDetail {
  endpoint: string;
  aor: string;
  contacts: string[];
  contactStatus?: string | null;
  roundtripUsec?: string | null;
  lastSeen?: string | null;
  expiresAt?: string | null;
}

export interface AmiInboundRegistrationDetail {
  trunkName: string;
  host: string;
  status: 'registered' | 'unregistered' | 'unknown';
  lastRegistration: string | null;
  expiresAt: string | null;
}

export interface ResourcesResponse {
  cpu: { usage: number } | { error: string };
  memory: { total: number; used: number; free: number; usagePercent: number } | { error: string };
  disk: { total: number; used: number; free: number; usagePercent: number } | { error: string };
  asterisk: { activeChannels: number } | { error: string };
  network: { bytesSent: number; bytesReceived: number } | { error: string };
}
