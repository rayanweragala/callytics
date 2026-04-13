export interface SipEndpointStatus {
  endpoint: string;
  aor: string;
  contacts: string[];
  state: 'registered' | 'unregistered' | 'unknown';
  updatedAt: number;
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

export interface DiagnosticsSnapshot {
  metrics: {
    activeCalls: number;
    registeredEndpoints: number;
    flows: number;
    uptimeSeconds: number;
  };
  sipStatuses: SipEndpointStatus[];
  timeline: Record<string, CallTimelineEvent[]>;
}
