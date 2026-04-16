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

export type BuilderNodeType = 'start' | 'play_audio' | 'get_digits' | 'menu' | 'hangup' | 'transfer' | 'hunt' | 'group';

export interface FlowNodeData {
  label: string;
  type: BuilderNodeType;
  config: Record<string, unknown>;
  onDelete?: () => void;
  onLabelChange?: (value: string) => void;
  onLabelSubmit?: () => void;
  onLabelDoubleClick?: () => void;
  onOpenSubmenu?: () => void;
  isEditing?: boolean;
  subflowId?: number | null;
}

export interface FlowApiNode {
  id: number;
  nodeKey: string;
  type: BuilderNodeType;
  label: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
  groupId: string | null;
  subflowId: number | null;
}

export interface FlowApiEdge {
  id: number;
  sourceNodeKey: string;
  targetNodeKey: string;
  branchKey: string;
  condition: string | null;
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
  parentFlowId: number | null;
  parentNodeKey: string | null;
  createdAt: string;
  updatedAt: string;
  versionId: number;
  versionNumber: number;
  nodes: FlowApiNode[];
  edges: FlowApiEdge[];
}

export interface FlowBreadcrumbItem {
  flowId: number;
  flowName: string;
}

export interface FlowTreeChild {
  nodeKey: string;
  nodeLabel: string;
  subflowId: number;
  name: string;
  children: FlowTreeChild[];
}

export interface FlowTree {
  id: number;
  name: string;
  children: FlowTreeChild[];
}

export interface FlowVersionSummary {
  id: number;
  flowId: number;
  versionNum: number;
  message: string;
  nodeCount: number;
  createdAt: string;
}

export interface FlowSnapshot {
  nodes: Array<{
    nodeKey: string;
    type: BuilderNodeType;
    label: string | null;
    positionX: number;
    positionY: number;
    config: Record<string, unknown>;
    groupId: string | null;
    subflowId: number | null;
  }>;
  edges: Array<{
    sourceNodeKey: string;
    targetNodeKey: string;
    branchKey: string;
    condition: string | null;
  }>;
}

export interface FlowVersionDetail extends FlowVersionSummary {
  snapshot: FlowSnapshot;
}

export interface AudioFileItem {
  id: number;
  name: string;
  sourceType: string;
  originalFilename: string | null;
  mimeType: string | null;
  durationMs: number | null;
  conversionStatus: string;
  ttsText: string | null;
  ttsVoice: string | null;
  speed: number;
  originalUrl: string | null;
  previewUrl: string | null;
  convertedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudioVoiceItem {
  id: string;
  label: string;
}

export interface ExtensionItem {
  id: number;
  username: string;
  password: string;
  displayName: string | null;
  createdAt: string;
}

export interface InboundRouteItem {
  id: number;
  did: string;
  flowId: number;
  flowName: string | null;
  label: string | null;
  createdAt: string;
}

export interface SipTrunkItem {
  id: number;
  name: string;
  providerPreset: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  fromDomain: string | null;
  fromUser: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface TrunkTestResult {
  status: 'reachable' | 'unreachable' | 'not_loaded';
  rtt_ms: number | null;
  message: string;
}

export interface RecordingItem {
  id: number;
  callId: string;
  channelId: string;
  flowId: number | null;
  flowName: string | null;
  fileName: string;
  filePath: string;
  format: string;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  streamUrl: string;
}
