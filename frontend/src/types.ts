export interface SipEndpointStatus {
  endpoint: string;
  aor: string;
  contacts: string[];
  state: 'registered' | 'unregistered' | 'unknown';
  updatedAt: number;
}

export interface DiagnosticsHealthItem {
  label: string;
  state: 'healthy' | 'down' | 'degraded';
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

export interface SipRegistrationItem {
  name: string;
  type: 'extension' | 'trunk';
  status: 'registered' | 'unregistered' | 'unknown';
  contactUri: string | null;
  rttMs: number | null;
  lastSeen: string | null;
}

export interface SipTrafficItem {
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

export interface SipPacket {
  id: string;
  timestamp: string;
  method: string;
  from: string;
  to: string;
  callId: string;
  direction: 'in' | 'out';
  statusCode?: number;
  rawJson: string;
}

export interface SipVerdict {
  message: string;
  cause: string;
  colour: 'green' | 'amber' | 'red';
}

export interface DiagnosticsFailureItem {
  id: number;
  callId: string;
  callUuid?: string;
  time: string;
  callerId: string | null;
  flowName: string | null;
  failedNodeType: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
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

export type BuilderNodeType =
  | 'start'
  | 'play_audio'
  | 'get_digits'
  | 'menu'
  | 'business_hours'
  | 'voicemail'
  | 'hangup'
  | 'transfer'
  | 'hunt'
  | 'group'
  | 'webhook'
  | 'queue_login'
  | 'queue';

export type TransferTargetType = 'extension' | 'pstn' | 'sip_uri';

export interface TransferNodeConfig {
  target_type: TransferTargetType;
  target_value: string;
  trunk_id?: number;
  timeout_ms?: number;
}

export interface HuntDestination {
  target_type: 'extension' | 'pstn';
  target_value: string;
  trunk_id?: number;
}

export interface HuntNodeConfig {
  destinations: HuntDestination[];
  ring_timeout_ms?: number;
}

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
  flowId?: number;
  name?: string;
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
  subflows?: FlowSnapshotSubflow[];
}

export interface FlowSnapshotSubflow {
  flowId: number;
  name: string;
  nodes: FlowSnapshot['nodes'];
  edges: FlowSnapshot['edges'];
  subflows?: FlowSnapshotSubflow[];
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

export interface ContactNumber {
  id: number;
  label: string;
  number: string;
  trunkId?: number;
  notes?: string;
  createdAt: string;
}

export interface ExtensionItem {
  id: number;
  username: string;
  password: string;
  displayName: string | null;
  transportType: 'sip' | 'webrtc';
  createdAt: string;
}

export interface OperatorItem {
  id: number;
  name: string;
  status: 'offline' | 'available' | 'busy';
  extension?: ExtensionItem;
  contactNumber?: ContactNumber;
  hasPIN: boolean;
  pin?: string | null;
  createdAt: string;
}

export interface QueueOperatorSummary {
  id: number;
  name: string;
}

export interface QueueItem {
  id: number;
  name: string;
  slug: string;
  waitAudioFileId: number | null;
  maxWaitSeconds: number;
  pinRetryAttempts: number;
  operatorCount: number;
  operatorIds: number[];
  operators: QueueOperatorSummary[];
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
  protocol?: string;
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

export interface TemplateItem {
  id: number;
  name: string;
  description: string | null;
  templateDescription: string | null;
  templateCategory: string | null;
  nodeCount: number;
}

export interface CallLogItem {
  id: number;
  callUuid: string;
  direction: string;
  callerNumber: string | null;
  calleeNumber: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  durationSeconds: number | null;
  talkSeconds: number | null;
  flowId: number | null;
  flowVersionId: number | null;
  entryNodeKey: string | null;
  exitNodeKey: string | null;
  flowName: string | null;
}

export interface CallQuality {
  callId: string;
  mos: number;
  jitter: number;
  packetLoss: number;
  rtt: number;
  grade: 'good' | 'fair' | 'poor';
  recordedAt: string;
}

export interface CallNodeTraceItem {
  id: number;
  nodeKey: string;
  nodeType: string;
  enteredAt: string;
  exitedAt: string | null;
  durationMs: number | null;
  exitBranch: string | null;
  errorMessage: string | null;
}

export interface CallTraceResponse {
  callUuid: string;
  callerNumber: string | null;
  startTime: string | null;
  nodes: CallNodeTraceItem[];
}
