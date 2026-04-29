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
  sipCode: number;
  sipCodeTitle: string;
  sipCodeExplanation: string;
  rawOptionsSent: string;
  rawOptionsResponse: string;
  rawCaptureAvailable: boolean;
  codecsSupported: string[];
}

export interface RegistrationExtensionItem {
  extension: string;
  displayName: string;
  status: 'registered' | 'unregistered';
  registeredIp: string | null;
  lastSeen: string | null;
  expiresIn: number | null;
}

export interface RegistrationTrunkItem {
  trunkName: string;
  host: string;
  status: 'registered' | 'unregistered' | 'unknown';
  lastRegistration: string | null;
  expiresIn: number | null;
}

export interface RegistrationHealthResponse {
  extensions: RegistrationExtensionItem[];
  trunks: RegistrationTrunkItem[];
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

export type PreflightStatus = 'pass' | 'warn' | 'fail';

export interface PreflightCheckResult {
  id: string;
  label: string;
  status: PreflightStatus;
  message: string;
  detail: string;
}

export interface PreflightRun {
  id: number;
  ranAt: string;
  summary: PreflightStatus;
  checks: PreflightCheckResult[];
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
  | 'queue'
  | 'conference'
  | 'callback';

export type TransferTargetType = 'extension' | 'pstn' | 'sip_uri';

export interface TransferNodeConfig {
  target_type: TransferTargetType;
  target_value: string;
  trunk_id?: number;
  timeout_ms?: number;
  on_no_answer?: string;
  waiting_sound_id?: number | null;
  no_answer_sound_id?: number | null;
  record_call?: boolean;
}

export interface HuntDestination {
  target_type: 'extension' | 'pstn';
  target_value: string;
  trunk_id?: number;
  order?: number;
}

export interface HuntNodeConfig {
  destinations: HuntDestination[];
  ring_timeout_ms?: number;
}

export interface CallbackNodeConfig {
  number_source: 'ani' | 'dtmf';
  dtmf_prompt_audio_id?: number | null;
  dtmf_max_digits?: number;
  timeout_ms?: number | null;
  confirmation_audio_id?: number | null;
  destination_type?: 'extension' | 'pstn' | 'operator' | 'caller';
  destination_value?: string | null;
  destination_trunk_id?: number | null;
  operator_id?: number | null;
}

export interface ConferenceNodeConfig {
  roomName: string;
  waitForModerator: boolean;
  moderatorType: 'extension' | 'pstn' | null;
  moderatorId: number | null;
}

export interface FlowNodeData {
  label: string;
  type: BuilderNodeType;
  config: Record<string, unknown>;
  hasValidationError?: boolean;
  validationIssues?: string[];
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
  value: string;
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
  vpnOnly: boolean;
  createdAt: string;
}

export interface VpnStatus {
  installed: boolean;
  running: boolean | null;
  serverPublicKey: string | null;
  serverPublicKeyError: string | null;
  endpoint: string | null;
  subnet: string | null;
  peerCount: number;
  subnetConflict: boolean;
  subnetConflictDetail: string | null;
}

export interface VpnPeer {
  id: number;
  name: string;
  assignedIp: string;
  publicKey: string;
  status: 'active' | 'idle' | 'offline';
  lastHandshake: string | null;
  bytesReceived: number;
  bytesSent: number;
  createdAt: string;
}

export interface CreatedVpnPeer extends VpnPeer {
  privateKey: string;
  config: string;
}

export type BackupType = 'full' | 'db_only' | 'recordings_only';
export type BackupStatus = 'pending' | 'running' | 'complete' | 'failed';
export type BackupInterval = 'daily' | 'weekly' | 'custom';

export interface BackupHistoryItem {
  id: number;
  filename: string;
  sizeBytes: number;
  type: BackupType;
  status: BackupStatus;
  createdAt: string;
  notes: string | null;
}

export interface BackupConfig {
  id: number;
  enabled: boolean;
  interval: BackupInterval;
  cronExpression: string | null;
  includeRecordings: boolean;
  retentionCount: number;
  updatedAt: string;
  nextRunAt: string | null;
}

export interface BackupConfigUpdate {
  enabled?: boolean;
  interval?: BackupInterval;
  cronExpression?: string | null;
  includeRecordings?: boolean;
  retentionCount?: number;
}

export interface BackupProgressEvent {
  percentage: number;
  step: string;
}

export interface RelayGuideCommand {
  command: string;
  explanation: string;
  verification: string | null;
  verificationExpected: string | null;
}

export interface RelayGuideStep {
  stepNumber: number;
  title: string;
  explanation: string;
  commands: RelayGuideCommand[];
}

export interface OperatorItem {
  id: number;
  name: string;
  status: 'offline' | 'available' | 'busy';
  extension?: ExtensionItem;
  contactNumber?: ContactNumber;
  hasPIN: boolean;
  pin?: string | null;
  callbackNumber?: string | null;
  callbackTrunkId?: number | null;
  createdAt: string;
}

export interface CallbackItem {
  id: number;
  flowId: number | null;
  trunkId: number | null;
  customerNumber: string;
  operatorId: number | null;
  operatorName: string | null;
  destinationType: 'extension' | 'pstn' | null;
  destinationValue: string | null;
  destinationTrunkId: number | null;
  status: 'pending' | 'dialing_operator' | 'dialing_customer' | 'bridged' | 'completed' | 'failed' | 'cancelled';
  failReason: string | null;
  callLogId: number | null;
  createdAt: string | null;
  executedAt: string | null;
  completedAt: string | null;
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
  campaignName: string | null;
}

export interface CampaignItem {
  id: number;
  name: string;
  status: 'draft' | 'scheduled' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  flowId: number | null;
  trunkId: number | null;
  callerId: string | null;
  defaultCountry: string;
  flowName: string | null;
  trunkName: string | null;
  scheduledAt: string | null;
  maxConcurrent: number;
  maxRetries: number;
  retryIntervalMinutes: number;
  totalContacts: number;
  dialedCount: number;
  answeredCount: number;
  failedCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CampaignContactItem {
  id: number;
  campaignId: number;
  phoneNumber: string;
  name: string | null;
  status: 'pending' | 'dialing' | 'answered' | 'completed' | 'no_answer' | 'busy' | 'failed';
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  createdAt: string | null;
}

export interface CampaignContactAttemptItem {
  id: number;
  campaignId: number;
  contactId: number;
  phoneNumber: string;
  attemptNumber: number;
  outcome: string;
  callLogId: number | null;
  startedAt: string | null;
  endedAt: string | null;
  duration: number | null;
  endReason: string | null;
}

export interface CampaignContactsUploadResult {
  imported: number;
  skipped: number;
  total: number;
  skippedReasons: string[];
}

export type AsteriskLogLevel = 'ERROR' | 'WARNING' | 'NOTICE' | 'VERBOSE' | 'DEBUG' | 'UNKNOWN';

export interface AsteriskLogEntry {
  timestamp: string;
  level: AsteriskLogLevel;
  channel: string;
  module: string;
  raw: string;
  message: string;
  translation?: string;
}

export interface AsteriskLogsResponse {
  entries: AsteriskLogEntry[];
  total: number;
  fileExists?: boolean;
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

export interface DiagnosticsResourcesResponse {
  cpu: { usage: number } | { error: string };
  memory: { total: number; used: number; free: number; usagePercent: number } | { error: string };
  disk: { total: number; used: number; free: number; usagePercent: number } | { error: string };
  asterisk: { activeChannels: number } | { error: string };
  network: { bytesSent: number; bytesReceived: number } | { error: string };
}

export type FirewallEventType = 'blocked' | 'allowed' | 'whitelisted';
export type FirewallEnforcementMode = 'iptables' | 'fail2ban';

export interface FirewallConfig {
  enforcementMode: FirewallEnforcementMode;
  threshold: number;
  timeWindowSeconds: number;
  blockDurationSeconds: number | null;
  trunkCeilings: Record<string, number>;
  fail2banInstalled: boolean;
}

export interface FirewallConfigUpdate {
  enforcementMode?: FirewallEnforcementMode;
  threshold?: number;
  timeWindowSeconds?: number;
  blockDurationSeconds?: number | null;
  trunkCeilings?: Record<string, number>;
}

export interface FirewallBlockedIp {
  id: number;
  ip: string;
  countryCode: string;
  countryName: string;
  attemptCount: number;
  reason: string;
  enforcementMode: FirewallEnforcementMode;
  expiresAt: string | null;
  createdAt: string;
  isWhitelisted: boolean;
}

export interface FirewallFeedEvent {
  ip: string;
  countryCode: string;
  countryName: string;
  eventType: FirewallEventType;
  reason: string;
  detail: string;
  createdAt: string;
}

export interface FirewallStats {
  totalBlockedToday: number;
  totalAttemptsToday: number;
  topIps: Array<{ ip: string; countryCode: string; attemptCount: number }>;
  topCountries: Array<{ countryCode: string; countryName: string; count: number }>;
  hourly: Array<{ hour: number; count: number }>;
  trunks: Array<{ id: number; name: string; activeCalls: number; ceiling: number }>;
}
