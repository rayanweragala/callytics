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

export type BuilderNodeType = 'start' | 'play_audio' | 'get_digits' | 'hangup';

export interface FlowNodeData {
  label: string;
  type: BuilderNodeType;
  config: Record<string, unknown>;
  onDelete?: () => void;
}

export interface FlowApiNode {
  id: number;
  nodeKey: string;
  type: BuilderNodeType;
  label: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}

export interface FlowApiEdge {
  id: number;
  sourceNodeKey: string;
  targetNodeKey: string;
  branchKey: string;
}

export interface FlowSummary {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface FlowDetail {
  id: number;
  name: string;
  description: string | null;
  slug: string;
  createdAt: string;
  updatedAt: string;
  versionId: number;
  versionNumber: number;
  nodes: FlowApiNode[];
  edges: FlowApiEdge[];
}
