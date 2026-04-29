import type { Edge, Node } from 'reactflow';
import type {
  BuilderNodeType,
  FlowDetail,
  FlowNodeData,
  FlowSnapshot,
  FlowSnapshotSubflow,
} from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
  isSubflowJump?: boolean;
  subflowJumpLabel?: string;
  onDelete?: (edgeId: string) => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const menuBranchOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
export const menuRoutableBranchSet = new Set(menuBranchOptions);
export const conditionValues = [
  ...Array.from({ length: 100 }, (_, index) => String(index)),
  ...Array.from({ length: 100 }, (_, index) => String(index).padStart(2, '0')),
  '*',
  '#',
  'timeout',
  'invalid',
  'default',
].filter((value, index, array) => array.indexOf(value) === index);
export const SUBFLOW_JUMP_NODE_ID_PREFIX = '__submenu_jump_anchor__';
export const QUEUE_LOGIN_TIMEOUT_MIN_MS = 1000;
export const QUEUE_LOGIN_TIMEOUT_MAX_MS = 120000;
export const QUEUE_LOGIN_TIMEOUT_DEFAULT_MS = 10000;
const GHOST_BRANCH_HEADER_OFFSET = 90;
const GHOST_BRANCH_ROW_STRIDE = 28;
const GHOST_NODE_HALF_HEIGHT = 18;

export const palette: Array<{ type: BuilderNodeType; label: string }> = [
  { type: 'start', label: 'start' },
  { type: 'play_audio', label: 'play audio' },
  { type: 'get_digits', label: 'get digits' },
  { type: 'menu', label: 'Menu Group' },
  { type: 'business_hours', label: 'Business Hours' },
  { type: 'transfer', label: 'transfer' },
  { type: 'voicemail', label: 'Voicemail' },
  { type: 'hunt', label: 'Hunt Group' },
  { type: 'webhook', label: 'Webhook' },
  { type: 'queue_login', label: 'Queue Login' },
  { type: 'queue', label: 'Queue' },
  { type: 'callback', label: 'Callback' },
  { type: 'hangup', label: 'hangup' },
];

export const miniMapSizeProps = { width: 160, height: 120 } as unknown as Record<string, number>;

// ─── Menu helpers ─────────────────────────────────────────────────────────────

export function sanitizeMenuBranches(value: unknown): string[] {
  if (!Array.isArray(value)) return ['1', '2'];
  const branches = value
    .map((item) => String(item || '').trim())
    .filter((item) => isValidMenuBranchValue(item));
  return branches.length > 0 ? Array.from(new Set(branches)) : ['1', '2'];
}

export function sanitizeMenuSubmenuTargets(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([branch, target]) => [String(branch || '').trim(), String(target || '').trim()] as const)
    .filter(([branch, target]) => isValidMenuBranchValue(branch) && Boolean(target));
  return Object.fromEntries(entries);
}

export function resolveMenuBranchValue(
  branchKey: string | null | undefined,
  condition: string | null | undefined
): string | null {
  const resolved = String(condition || branchKey || '').trim();
  return isValidMenuBranchValue(resolved) ? resolved : null;
}

export function buildMenuSubmenuTargets(options: {
  configuredBranches: string[];
  currentTargets: Record<string, string>;
  localEdgeBranches: Set<string>;
  submenuStartNodeKey: string | null;
}): Record<string, string> {
  const {
    configuredBranches,
    currentTargets,
    localEdgeBranches,
    submenuStartNodeKey,
  } = options;
  const nextTargets = { ...currentTargets };

  for (const branch of Object.keys(nextTargets)) {
    if (localEdgeBranches.has(branch) || !configuredBranches.includes(branch)) {
      delete nextTargets[branch];
    }
  }

  if (!submenuStartNodeKey) {
    return nextTargets;
  }

  for (const branch of configuredBranches) {
    if (localEdgeBranches.has(branch)) {
      continue;
    }
    nextTargets[branch] = submenuStartNodeKey;
  }

  return nextTargets;
}

export interface FlowNodeValidationIssue {
  nodeId: string;
  nodeLabel: string;
  nodeType: BuilderNodeType;
  issues: string[];
}

export function isValidDigitConditionValue(value: string): boolean {
  return /^(?:\d{1,2}|\*|#|timeout|invalid|default)$/.test(value.trim());
}

export function isValidMenuBranchValue(value: string): boolean {
  return /^(?:\d{1,2}|\*|#)$/.test(value.trim());
}

function isPositiveId(value: unknown): boolean {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0;
}

function hasEnabledBusinessHoursSchedule(config: Record<string, unknown>): boolean {
  const schedule = config.schedule;
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    return false;
  }
  return Object.values(schedule as Record<string, unknown>).some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    return Boolean((entry as Record<string, unknown>).enabled);
  });
}

function hasWebhookPredecessor(
  nodeId: string,
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): boolean {
  const nodeTypeMap = new Map(nodes.map((node) => [node.id, node.data.type]));
  return edges.some((edge) => edge.target === nodeId && nodeTypeMap.get(edge.source) === 'webhook');
}

export function validateNodeConfigurations(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): FlowNodeValidationIssue[] {
  return nodes
    .filter((node) => node.data.type !== 'start' && node.data.type !== 'hangup' && node.data.type !== 'group')
    .map((node) => {
      const config = (node.data.config || {}) as Record<string, unknown>;
      const issues: string[] = [];

      switch (node.data.type) {
        case 'play_audio':
          if (!isPositiveId(config.audio_file_id)) {
            issues.push('audio file is required');
          }
          break;
        case 'get_digits':
          if (!String(config.variable_name || '').trim()) {
            issues.push('variable name is required');
          }
          if (config.timeout_ms === null || config.timeout_ms === undefined || config.timeout_ms === '') {
            issues.push('timeout is required');
          }
          break;
        case 'menu':
          if (sanitizeMenuBranches(config.branches).length === 0) {
            issues.push('at least one branch is required');
          }
          if (!isPositiveId(config.prompt_audio_file_id)) {
            issues.push('prompt audio is required');
          }
          break;
        case 'transfer':
          if (!String(config.target_value || config.destination || '').trim()) {
            issues.push('destination is required');
          }
          break;
        case 'hunt': {
          const destinations = Array.isArray(config.destinations) ? config.destinations : [];
          const hasDestination = destinations.some((entry) => String((entry as Record<string, unknown>)?.target_value || '').trim().length > 0);
          if (!hasDestination) {
            issues.push('at least one destination is required');
          }
          break;
        }
        case 'queue':
        case 'queue_login':
          if (!isPositiveId(config.queue_id)) {
            issues.push('queue is required');
          }
          break;
        case 'voicemail':
          if (!isPositiveId(config.start_audio_id)) {
            issues.push('intro message is required');
          }
          if (Boolean(config.send_to_webhook) && !hasWebhookPredecessor(node.id, nodes, edges)) {
            issues.push('send recording to webhook requires a webhook directly before this node');
          }
          break;
        case 'webhook': {
          const url = String(config.url || '').trim();
          if (!url) {
            issues.push('URL is required');
          } else {
            try {
              const parsed = new URL(url);
              if (!['http:', 'https:'].includes(parsed.protocol)) {
                issues.push('URL must use http or https');
              }
            } catch {
              issues.push('URL must be valid');
            }
          }
          break;
        }
        case 'callback':
          if (!String(config.number_source || '').trim()) {
            issues.push('caller number source is required');
          }
          if (!String(config.destination_value || '').trim()) {
            issues.push('destination is required');
          }
          break;
        case 'conference':
          if (!String(config.roomName || config.room_name || '').trim()) {
            issues.push('room name is required');
          }
          break;
        case 'business_hours':
          if (!hasEnabledBusinessHoursSchedule(config)) {
            issues.push('at least one schedule is required');
          }
          break;
        default:
          break;
      }

      return {
        nodeId: node.id,
        nodeLabel: node.data.label || node.id,
        nodeType: node.data.type,
        issues,
      };
    })
    .filter((issue) => issue.issues.length > 0);
}

export function isImmediateHangupFlow(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): boolean {
  const realNodes = nodes.filter((node) => node.data.type !== 'group');
  if (realNodes.length !== 2 || edges.length !== 1) {
    return false;
  }
  const startNode = realNodes.find((node) => node.data.type === 'start');
  const hangupNode = realNodes.find((node) => node.data.type === 'hangup');
  if (!startNode || !hangupNode) {
    return false;
  }
  return edges[0].source === startNode.id && edges[0].target === hangupNode.id;
}

// ─── Node dimension helpers ───────────────────────────────────────────────────

export function resolveNodeDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

function sortObjectKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item)) as T;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sortedEntries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => [key, sortObjectKeysDeep((value as Record<string, unknown>)[key])]);
  return Object.fromEntries(sortedEntries) as T;
}

// ─── Node creation ────────────────────────────────────────────────────────────

export function typeConfig(type: BuilderNodeType): Record<string, unknown> {
  if (type === 'start')
    return { queue_login_default_input_timeout_ms: QUEUE_LOGIN_TIMEOUT_DEFAULT_MS };
  if (type === 'play_audio') return { audio_file_path: '', audio_file_id: '' };
  if (type === 'get_digits') return { variable_name: '', timeout_ms: 5000, prompt_path: '', prompt_audio_file_id: '' };
  if (type === 'menu')
    return {
      timeout_ms: 5000,
      prompt_path: '',
      prompt_audio_file_id: '',
      timeout_prompt_audio_id: '',
      invalid_prompt_audio_id: '',
      final_failure_audio_id: '',
      max_timeout_attempts: 3,
      max_invalid_attempts: 3,
      branches: ['1', '2'],
      submenu_branch_targets: {},
    };
  if (type === 'business_hours')
    return {
      timezone: '',
      schedule: {
        monday: { enabled: true, open: '09:00', close: '17:00' },
        tuesday: { enabled: true, open: '09:00', close: '17:00' },
        wednesday: { enabled: true, open: '09:00', close: '17:00' },
        thursday: { enabled: true, open: '09:00', close: '17:00' },
        friday: { enabled: true, open: '09:00', close: '17:00' },
        saturday: { enabled: false, open: '09:00', close: '17:00' },
        sunday: { enabled: false, open: '09:00', close: '17:00' },
      },
    };
  if (type === 'transfer')
    return { target_type: 'extension', target_value: '', timeout_ms: 30000, on_no_answer: '' };
  if (type === 'voicemail')
    return { mailbox_name: 'main', max_duration_seconds: 60, start_audio_id: null, end_audio_id: null, send_to_webhook: false };
  if (type === 'hunt')
    return {
      destinations: [{ target_type: 'extension', target_value: '101' }],
      strategy: 'sequential',
      attempt_timeout_ms: 20000,
      total_timeout_ms: 60000,
      hold_audio_file_id: null,
      busy_audio_file_id: null,
      on_no_answer: '',
    };
  if (type === 'webhook')
    return {
      url: '',
      method: 'POST',
      include_caller: false,
      include_digits: false,
      timeout_ms: 5000,
      headers: [],
    };
  if (type === 'queue_login')
    return {
      queue_id: null,
      prompt_audio_file_id: null,
      wrong_pin_audio_file_id: null,
      login_success_audio_file_id: null,
      use_flow_default_timeout: true,
      input_timeout_ms: null,
    };
  if (type === 'queue') return { queue_id: null, prompt_audio_file_id: null };
  if (type === 'callback')
    return {
      number_source: 'ani',
      dtmf_prompt_audio_id: null,
      dtmf_max_digits: 11,
      confirmation_audio_id: null,
      destination_type: 'operator',
      destination_value: null,
      destination_trunk_id: null,
      operator_id: null,
    };
  return {};
}

export function getQueueLoginFlowDefaultTimeoutMs(nodes: Array<Node<FlowNodeData>>): number | null {
  const startNode = nodes.find((node) => node.data.type === 'start') || null;
  if (!startNode) return null;
  const raw = startNode.data.config.queue_login_default_input_timeout_ms;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < QUEUE_LOGIN_TIMEOUT_MIN_MS || numeric > QUEUE_LOGIN_TIMEOUT_MAX_MS) return null;
  return numeric;
}

export function validateQueueLoginTimeoutConfig(nodes: Array<Node<FlowNodeData>>): {
  errors: string[];
  warningCount: number;
} {
  const errors: string[] = [];
  const flowDefaultTimeout = getQueueLoginFlowDefaultTimeoutMs(nodes);
  const startNode = nodes.find((node) => node.data.type === 'start') || null;
  if (startNode) {
    const rawFlowDefault = startNode.data.config.queue_login_default_input_timeout_ms;
    if (rawFlowDefault !== undefined && rawFlowDefault !== null && rawFlowDefault !== '') {
      const parsedFlowDefault =
        typeof rawFlowDefault === 'number' ? rawFlowDefault : Number(rawFlowDefault);
      if (
        !Number.isInteger(parsedFlowDefault) ||
        parsedFlowDefault < QUEUE_LOGIN_TIMEOUT_MIN_MS ||
        parsedFlowDefault > QUEUE_LOGIN_TIMEOUT_MAX_MS
      ) {
        errors.push(
          `Start node: queue login default timeout must be ${QUEUE_LOGIN_TIMEOUT_MIN_MS}-${QUEUE_LOGIN_TIMEOUT_MAX_MS} ms.`
        );
      }
    }
  }
  let warningCount = 0;

  for (const node of nodes) {
    if (node.data.type !== 'queue_login') continue;
    const config = node.data.config || {};
    const useFlowDefaultTimeout = config.use_flow_default_timeout !== false;
    const rawTimeout = config.input_timeout_ms;
    const timeoutMs = typeof rawTimeout === 'number' ? rawTimeout : Number(rawTimeout);
    const nodeLabel = node.data.label || node.id;

    if (useFlowDefaultTimeout) {
      if (flowDefaultTimeout === null) {
        warningCount += 1;
      }
      continue;
    }

    if (!Number.isInteger(timeoutMs)) {
      errors.push(
        `Queue Login "${nodeLabel}": input timeout is required when not using flow default.`
      );
      continue;
    }

    if (timeoutMs < QUEUE_LOGIN_TIMEOUT_MIN_MS || timeoutMs > QUEUE_LOGIN_TIMEOUT_MAX_MS) {
      errors.push(
        `Queue Login "${nodeLabel}": input timeout must be ${QUEUE_LOGIN_TIMEOUT_MIN_MS}-${QUEUE_LOGIN_TIMEOUT_MAX_MS} ms.`
      );
    }
  }

  return { errors, warningCount };
}

export function getFlowDefaultTimeoutMs(nodes: Array<Node<FlowNodeData>>): number | null {
  const startNode = nodes.find((node) => node.data.type === 'start') || null;
  if (!startNode) return null;
  const raw = startNode.data.config.flow_default_timeout_ms;
  const numeric = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < QUEUE_LOGIN_TIMEOUT_MIN_MS || numeric > QUEUE_LOGIN_TIMEOUT_MAX_MS) return null;
  return numeric;
}

export function validateFlowTimeoutConfig(
  nodes: Array<Node<FlowNodeData>>,
  options?: { isSubflow?: boolean }
): { errors: string[]; warningCount: number } {
  const errors: string[] = [];
  const flowDefaultTimeout = getFlowDefaultTimeoutMs(nodes);
  const startNode = nodes.find((node) => node.data.type === 'start') || null;

  // Validate flow default timeout on start node, unless this is a subflow
  if (!options?.isSubflow && startNode) {
    const rawFlowDefault = startNode.data.config.flow_default_timeout_ms;
    if (rawFlowDefault !== undefined && rawFlowDefault !== null && rawFlowDefault !== '') {
      const parsedFlowDefault =
        typeof rawFlowDefault === 'number' ? rawFlowDefault : Number(rawFlowDefault);
      if (
        !Number.isInteger(parsedFlowDefault) ||
        parsedFlowDefault < QUEUE_LOGIN_TIMEOUT_MIN_MS ||
        parsedFlowDefault > QUEUE_LOGIN_TIMEOUT_MAX_MS
      ) {
        errors.push(
          `Start node: flow default timeout must be ${QUEUE_LOGIN_TIMEOUT_MIN_MS}-${QUEUE_LOGIN_TIMEOUT_MAX_MS} ms.`
        );
      }
    }
  }

  let warningCount = 0;

  for (const node of nodes) {
    if (node.data.type !== 'queue_login') continue;
    const config = node.data.config || {};
    const useFlowDefaultTimeout = config.use_flow_default_timeout !== false;
    const rawTimeout = config.input_timeout_ms;
    const timeoutMs = typeof rawTimeout === 'number' ? rawTimeout : Number(rawTimeout);
    const nodeLabel = node.data.label || node.id;

    if (useFlowDefaultTimeout) {
      if (flowDefaultTimeout === null) {
        warningCount += 1;
      }
      continue;
    }

    if (!Number.isInteger(timeoutMs)) {
      errors.push(
        `Queue Login "${nodeLabel}": input timeout is required when not using flow default.`
      );
      continue;
    }

    if (timeoutMs < QUEUE_LOGIN_TIMEOUT_MIN_MS || timeoutMs > QUEUE_LOGIN_TIMEOUT_MAX_MS) {
      errors.push(
        `Queue Login "${nodeLabel}": input timeout must be ${QUEUE_LOGIN_TIMEOUT_MIN_MS}-${QUEUE_LOGIN_TIMEOUT_MAX_MS} ms.`
      );
    }
  }

  return { errors, warningCount };
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeNodeForSave(node: Node<FlowNodeData>) {
  const isGroup = node.data.type === 'group';
  const config = isGroup
    ? {
        ...node.data.config,
        width: Math.max(
          200,
          resolveNodeDimension(node.width ?? node.style?.width ?? node.data.config.width, 200)
        ),
        height: Math.max(
          150,
          resolveNodeDimension(node.height ?? node.style?.height ?? node.data.config.height, 150)
        ),
      }
    : node.data.type === 'menu'
      ? {
          ...node.data.config,
          branches: sanitizeMenuBranches(node.data.config.branches),
          submenu_branch_targets: sanitizeMenuSubmenuTargets(
            node.data.config.submenu_branch_targets
          ),
        }
      : node.data.config;
  return {
    nodeKey: node.id,
    type: node.data.type,
    label: node.data.label,
    positionX: node.position.x,
    positionY: node.position.y,
    config: sortObjectKeysDeep(config),
    groupId: node.parentId ?? null,
    subflowId: node.data.subflowId ?? null,
  };
}

export function createSavePayload(
  flow: FlowDetail,
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
  versionMessage?: string
) {
  const nodeTypeMap = new Map(nodes.map((node) => [node.id, node.data.type]));
  const persistedEdges = edges
    .filter((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.source);
      const branchKey = String(edge.data?.branchKey || edge.data?.condition || 'default');
      if (sourceNodeType !== 'menu') return true;
      return branchKey === 'complete' || isValidMenuBranchValue(branchKey);
    })
    .map((edge) => ({
      sourceNodeKey: edge.source,
      targetNodeKey: edge.target,
      branchKey: String(edge.data?.branchKey || edge.data?.condition || 'default'),
      condition: edge.data?.condition ?? null,
    }));
  return {
    name: flow.name,
    description: flow.description || '',
    slug: flow.slug,
    versionMessage,
    nodes: nodes.map(serializeNodeForSave),
    edges: persistedEdges,
  };
}

export async function validateFlowBeforeSave(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>
): Promise<string | null> {
  const { getFlow } = await import('../lib/api');
  const nodeTypeMap = new Map(nodes.map((node) => [node.id, node.data.type]));
  const persistedEdges = edges
    .filter((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.source);
      const branchKey = String(edge.data?.branchKey || edge.data?.condition || 'default');
      if (sourceNodeType !== 'menu') return true;
      return branchKey === 'complete' || isValidMenuBranchValue(branchKey);
    })
    .map((edge) => ({
      sourceNodeKey: edge.source,
      targetNodeKey: edge.target,
      branchKey: String(edge.data?.branchKey || edge.data?.condition || 'default'),
      condition: edge.data?.condition ?? null,
    }));
  const sourceOutgoing = new Map<string, Array<{ branchKey: string; condition: string | null }>>();
  for (const edge of persistedEdges) {
    const current = sourceOutgoing.get(edge.sourceNodeKey) || [];
    current.push({ branchKey: edge.branchKey, condition: edge.condition });
    sourceOutgoing.set(edge.sourceNodeKey, current);
  }
  const subflowNodeKeysById = new Map<number, Set<string>>();
  async function loadSubflowNodeKeys(subflowId: number): Promise<Set<string> | null> {
    if (subflowNodeKeysById.has(subflowId)) return subflowNodeKeysById.get(subflowId) || null;
    try {
      const response = await getFlow(String(subflowId));
      const nodeKeys = new Set(response.data.nodes.map((item) => item.nodeKey));
      subflowNodeKeysById.set(subflowId, nodeKeys);
      return nodeKeys;
    } catch {
      return null;
    }
  }
  for (const node of nodes) {
    if (node.data.type !== 'menu') continue;
    const configuredBranches = sanitizeMenuBranches(node.data.config.branches);
    const submenuTargets = sanitizeMenuSubmenuTargets(node.data.config.submenu_branch_targets);
    const subflowId = Number(node.data.subflowId || 0);
    if (subflowId <= 0) continue;
    const outgoing = sourceOutgoing.get(node.id) || [];
    const routedBranches = new Set(
      outgoing
        .map((item) => String(item.condition || item.branchKey || '').trim())
        .filter((item) => isValidMenuBranchValue(item))
    );
    const missing: string[] = [];
    for (const branch of configuredBranches) {
      if (routedBranches.has(branch)) continue;
      const submenuTarget = String(submenuTargets[branch] || '').trim();
      if (!submenuTarget) {
        missing.push(branch);
        continue;
      }
      const nodeKeys = await loadSubflowNodeKeys(subflowId);
      if (!nodeKeys)
        return `Menu "${node.data.label || node.id}" points to submenu #${subflowId}, but it could not be loaded.`;
      if (!nodeKeys.has(submenuTarget))
        return `Menu "${node.data.label || node.id}" maps branch "${branch}" to missing submenu node "${submenuTarget}".`;
    }
    if (missing.length > 0)
      return `Menu "${node.data.label || node.id}" is missing route(s) for: ${missing.join(', ')}.`;
  }
  for (const node of nodes) {
    if (
      node.data.type === 'hangup' ||
      node.data.type === 'group' ||
      node.data.type === 'menu' ||
      node.data.type === 'play_audio' ||
      node.data.type === 'transfer' ||
      node.data.type === 'hunt' ||
      node.data.type === 'queue_login' ||
      node.data.type === 'queue'
    )
      continue;
    const outgoingCount = (sourceOutgoing.get(node.id) || []).length;
    if (outgoingCount === 0)
      return `Node "${node.data.label || node.id}" (${node.data.type}) has no outgoing path.`;
  }
  return null;
}

export function buildEditorSnapshot(
  flow: FlowDetail | null,
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>
): string {
  if (!flow) return '';
  return JSON.stringify(createSavePayload(flow, nodes, edges));
}

// ─── Draft flow ───────────────────────────────────────────────────────────────

export function createDraftFlow(): FlowDetail {
  const now = new Date().toISOString();
  return {
    id: 0,
    name: 'Untitled Flow',
    description: 'New flow',
    slug: 'untitled-flow',
    parentFlowId: null,
    parentNodeKey: null,
    createdAt: now,
    updatedAt: now,
    versionId: 0,
    versionNumber: 0,
    nodes: [],
    edges: [],
  };
}

// ─── Auto-layout ──────────────────────────────────────────────────────────────

const AUTO_LAYOUT_DEFAULT_NODE_HEIGHT = 72;
const AUTO_LAYOUT_MENU_BASE_HEIGHT = 160;
const AUTO_LAYOUT_MENU_BRANCH_ROW_HEIGHT = 28;
const AUTO_LAYOUT_VERTICAL_GAP = 80;

function resolveAutoLayoutNodeHeight(node: Node<FlowNodeData>): number {
  if (node.data.type !== 'menu') return AUTO_LAYOUT_DEFAULT_NODE_HEIGHT;
  const branchCount = Array.isArray(node.data.config.branches)
    ? node.data.config.branches.map((value) => String(value || '').trim()).filter(Boolean).length
    : 2;
  return (
    AUTO_LAYOUT_MENU_BASE_HEIGHT + Math.max(2, branchCount) * AUTO_LAYOUT_MENU_BRANCH_ROW_HEIGHT
  );
}

function shouldAutoArrange(nodes: Array<Node<FlowNodeData>>): boolean {
  if (nodes.length <= 1) return false;
  const xValues = nodes.map((node) => node.position.x);
  const yValues = nodes.map((node) => node.position.y);
  return (
    Math.max(...xValues) - Math.min(...xValues) < 300 &&
    Math.max(...yValues) - Math.min(...yValues) < 300
  );
}

export function applyAutoLayout(
  nodes: Array<Node<FlowNodeData>>,
  panelWidth: number
): Array<Node<FlowNodeData>> {
  if (!shouldAutoArrange(nodes)) return nodes;
  const centerX = Math.max(80, Math.round(panelWidth / 2) - 85);
  let currentY = 80;
  return nodes.map((node) => {
    const nextNode = { ...node, position: { x: centerX, y: currentY } };
    currentY += resolveAutoLayoutNodeHeight(node) + AUTO_LAYOUT_VERTICAL_GAP;
    return nextNode;
  });
}

// ─── Flow → canvas mapping ────────────────────────────────────────────────────

export function mapFlowToNodes(flow: FlowDetail): Array<Node<FlowNodeData>> {
  const groups = flow.nodes
    .filter((node) => node.type === 'group')
    .map((node) => ({
      id: node.nodeKey,
      type: 'group',
      position: { x: node.positionX, y: node.positionY },
      data: { label: node.label || node.nodeKey, type: node.type, config: node.config },
      style: {
        width: Math.max(200, resolveNodeDimension(node.config.width, 200)),
        height: Math.max(150, resolveNodeDimension(node.config.height, 150)),
      },
      draggable: true,
      selectable: true,
    }));
  const childNodes = flow.nodes
    .filter((node) => node.type !== 'group')
    .map((node) => ({
      id: node.nodeKey,
      type: node.type === 'hunt' ? 'huntNode' : node.type === 'menu' ? 'menuNode' : 'flowNode',
      position: { x: node.positionX, y: node.positionY },
      data: {
        label: node.label || node.nodeKey,
        type: node.type,
        config:
          node.type === 'menu'
            ? { ...node.config, branches: sanitizeMenuBranches(node.config.branches) }
            : node.config,
        subflowId: node.subflowId,
      },
      parentId: node.groupId || undefined,
      extent: node.groupId ? ('parent' as const) : undefined,
      draggable: true,
      selectable: true,
    }));
  return [...groups, ...childNodes];
}

export function mapFlowToEdges(flow: FlowDetail): Edge<BuilderEdgeData>[] {
  const nodeTypeMap = new Map(flow.nodes.map((node) => [node.nodeKey, node.type]));
  return flow.edges
    .filter((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.sourceNodeKey) || 'hangup';
      if (sourceNodeType !== 'menu') return true;
      const branchKey = edge.condition || edge.branchKey || '';
      return branchKey === 'complete' || isValidMenuBranchValue(branchKey);
    })
    .map((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.sourceNodeKey) || 'hangup';
      const sourceHandle =
        sourceNodeType === 'menu'
          ? edge.condition || edge.branchKey || undefined
          : sourceNodeType === 'get_digits'
            ? edge.condition || undefined
            : undefined;
      return {
        id: String(edge.id),
        source: edge.sourceNodeKey,
        target: edge.targetNodeKey,
        sourceHandle,
        label: undefined,
        type: 'flowEdge',
        selectable: true,
        reconnectable: true,
        data: { branchKey: edge.branchKey, condition: edge.condition, sourceNodeType },
        style: { stroke: 'var(--border-strong)' },
      };
    });
}

// ─── Snapshot → canvas mapping ────────────────────────────────────────────────

export function mapSnapshotToNodes(snapshot: FlowSnapshot): Array<Node<FlowNodeData>> {
  const flattenSnapshot = (
    input: FlowSnapshot | FlowSnapshotSubflow,
    scope: string
  ): FlowSnapshot['nodes'] => {
    const scopedNodes = input.nodes.map((node) => ({
      ...node,
      nodeKey: `${scope}::${node.nodeKey}`,
      groupId: node.groupId ? `${scope}::${node.groupId}` : null,
    }));
    const nested = (input.subflows ?? []).flatMap((subflow) =>
      flattenSnapshot(subflow, `${scope}/subflow-${subflow.flowId}`)
    );
    return [...scopedNodes, ...nested];
  };

  const flattenedNodes = flattenSnapshot(snapshot, `flow-${snapshot.flowId ?? 'root'}`);
  const flowLike: FlowDetail = {
    id: 0,
    name: '',
    description: null,
    slug: '',
    parentFlowId: null,
    parentNodeKey: null,
    createdAt: '',
    updatedAt: '',
    versionId: 0,
    versionNumber: 0,
    nodes: flattenedNodes.map((node, index) => ({
      id: index + 1,
      nodeKey: node.nodeKey,
      type: node.type,
      label: node.label,
      positionX: node.positionX,
      positionY: node.positionY,
      config: node.config,
      groupId: node.groupId,
      subflowId: node.subflowId,
    })),
    edges: [],
  };
  return mapFlowToNodes(flowLike);
}

export function mapSnapshotToEdges(snapshot: FlowSnapshot): Edge<BuilderEdgeData>[] {
  const flattenSnapshot = (
    input: FlowSnapshot | FlowSnapshotSubflow,
    scope: string
  ): { nodes: FlowSnapshot['nodes']; edges: FlowSnapshot['edges'] } => {
    const scopedNodes = input.nodes.map((node) => ({
      ...node,
      nodeKey: `${scope}::${node.nodeKey}`,
      groupId: node.groupId ? `${scope}::${node.groupId}` : null,
    }));
    const scopedEdges = input.edges.map((edge) => ({
      ...edge,
      sourceNodeKey: `${scope}::${edge.sourceNodeKey}`,
      targetNodeKey: `${scope}::${edge.targetNodeKey}`,
    }));
    const nested = (input.subflows ?? []).map((subflow) =>
      flattenSnapshot(subflow, `${scope}/subflow-${subflow.flowId}`)
    );
    return {
      nodes: [...scopedNodes, ...nested.flatMap((item) => item.nodes)],
      edges: [...scopedEdges, ...nested.flatMap((item) => item.edges)],
    };
  };

  const flattened = flattenSnapshot(snapshot, `flow-${snapshot.flowId ?? 'root'}`);
  const flowLike: FlowDetail = {
    id: 0,
    name: '',
    description: null,
    slug: '',
    parentFlowId: null,
    parentNodeKey: null,
    createdAt: '',
    updatedAt: '',
    versionId: 0,
    versionNumber: 0,
    nodes: flattened.nodes.map((node, index) => ({
      id: index + 1,
      nodeKey: node.nodeKey,
      type: node.type,
      label: node.label,
      positionX: node.positionX,
      positionY: node.positionY,
      config: node.config,
      groupId: node.groupId,
      subflowId: node.subflowId,
    })),
    edges: flattened.edges.map((edge, index) => ({
      id: index + 1,
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      branchKey: edge.branchKey,
      condition: edge.condition,
    })),
  };
  return mapFlowToEdges(flowLike);
}

// ─── Subflow jump visuals ─────────────────────────────────────────────────────

export function buildSubflowJumpVisuals(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>
): { nodes: Array<Node<FlowNodeData>>; edges: Array<Edge<BuilderEdgeData>> } {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const localMenuEdgeBranches = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode || sourceNode.data.type !== 'menu') continue;
    const branch = resolveMenuBranchValue(edge.data?.branchKey, edge.data?.condition);
    if (!branch) continue;
    const set = localMenuEdgeBranches.get(edge.source) || new Set<string>();
    set.add(branch);
    localMenuEdgeBranches.set(edge.source, set);
  }
  function getAbsolutePos(node: Node<FlowNodeData>): { x: number; y: number } {
    if (!node.parentId) return node.position;
    const parent = nodeMap.get(node.parentId);
    if (!parent) return node.position;
    const parentPos = getAbsolutePos(parent);
    return { x: parentPos.x + node.position.x, y: parentPos.y + node.position.y };
  }
  const visualNodes: Array<Node<FlowNodeData>> = [];
  const visualEdges: Array<Edge<BuilderEdgeData>> = [];
  for (const menuNode of nodes) {
    if (menuNode.data.type !== 'menu') continue;
    const configuredBranches = sanitizeMenuBranches(menuNode.data.config.branches);
    const submenuTargets = sanitizeMenuSubmenuTargets(menuNode.data.config.submenu_branch_targets);
    const locallyConnectedBranches = localMenuEdgeBranches.get(menuNode.id) || new Set<string>();
    const absolutePosition = getAbsolutePos(menuNode);
    const subflowId = Number(menuNode.data.subflowId || 0);
    for (let branchIndex = 0; branchIndex < configuredBranches.length; branchIndex++) {
      const branch = configuredBranches[branchIndex];
      if (locallyConnectedBranches.has(branch)) continue;
      const targetNodeKey = String(submenuTargets[branch] || '').trim();
      if (!targetNodeKey) continue;
      const anchorId = `${SUBFLOW_JUMP_NODE_ID_PREFIX}${menuNode.id}__${branch}`;
      const anchorX = absolutePosition.x + 480;
      const anchorY =
        absolutePosition.y +
        GHOST_BRANCH_HEADER_OFFSET +
        branchIndex * GHOST_BRANCH_ROW_STRIDE -
        GHOST_NODE_HALF_HEIGHT;
      const jumpTargetLabel =
        subflowId > 0 ? `subflow #${subflowId}:${targetNodeKey}` : `submenu:${targetNodeKey}`;
      visualNodes.push({
        id: anchorId,
        position: { x: anchorX, y: anchorY },
        draggable: false,
        selectable: false,
        connectable: false,
        data: { label: jumpTargetLabel, type: 'hangup', config: {} },
        style: {
          width: 176,
          padding: '10px 12px',
          border: '1px dashed var(--color-info)',
          borderRadius: '8px',
          background: 'var(--bg-surface)',
          color: 'var(--text-secondary)',
          fontFamily: "'Space Mono', monospace",
          fontSize: '11px',
        },
      });
      visualEdges.push({
        id: `submenu-jump-edge::${menuNode.id}::${branch}`,
        source: menuNode.id,
        target: anchorId,
        sourceHandle: branch,
        reconnectable: false,
        type: 'flowEdge',
        data: { branchKey: branch, condition: branch, sourceNodeType: 'menu', isSubflowJump: true },
      });
    }
  }
  return { nodes: visualNodes, edges: visualEdges };
}

// ─── Version diff utilities ───────────────────────────────────────────────────

export function makeVersionEdgeKey(edge: {
  source: string;
  target: string;
  data?: { branchKey?: string | null; condition?: string | null };
}): string {
  return `${edge.source}|${edge.target}|${edge.data?.branchKey || ''}|${edge.data?.condition || ''}`;
}

export function decorateDiffNodes(
  nodes: Array<Node<FlowNodeData>>,
  nodeIds: Set<string>,
  colorVar: string,
  changedNodeIds?: Set<string>,
  changedColorVar?: string
): Array<Node<FlowNodeData>> {
  return nodes.map((node) => {
    if (nodeIds.has(node.id)) {
      return { ...node, style: { ...node.style, borderLeft: `2px solid var(${colorVar})` } };
    }
    if (changedNodeIds && changedColorVar && changedNodeIds.has(node.id)) {
      return { ...node, style: { ...node.style, borderLeft: `2px solid var(${changedColorVar})` } };
    }
    return node;
  });
}

export function decorateDiffEdges(
  edges: Array<Edge<BuilderEdgeData>>,
  changedKeys: Set<string>
): Array<Edge<BuilderEdgeData>> {
  return edges.map((edge) =>
    changedKeys.has(makeVersionEdgeKey(edge))
      ? {
          ...edge,
          type: undefined,
          style: { stroke: 'var(--color-warning)', strokeWidth: 2 },
          markerEnd: undefined,
        }
      : {
          ...edge,
          type: undefined,
          style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 },
          markerEnd: undefined,
        }
  );
}

// ─── Minimap / palette UI helpers ─────────────────────────────────────────────

export function minimapNodeColor(node: Node<FlowNodeData>): string {
  switch (node.data?.type) {
    case 'start':
      return 'var(--accent)';
    case 'play_audio':
      return 'var(--color-info)';
    case 'get_digits':
      return 'var(--color-warning)';
    case 'menu':
      return 'var(--color-warning)';
    case 'business_hours':
      return 'var(--accent)';
    case 'transfer':
      return 'var(--color-info)';
    case 'voicemail':
      return 'var(--color-warning)';
    case 'hunt':
      return 'var(--color-warning)';
    case 'hangup':
      return 'var(--color-error)';
    case 'group':
      return 'var(--accent)';
    case 'webhook':
      return 'var(--color-info)';
    case 'queue_login':
      return 'var(--color-warning)';
    case 'queue':
      return 'var(--color-warning)';
    case 'callback':
      return 'var(--color-info)';
    default:
      return 'var(--text-muted)';
  }
}

export function renderPaletteIcon(type: BuilderNodeType) {
  if (type === 'business_hours') {
    return (
      <span
        style={{
          width: 16,
          height: 16,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          focusable="false"
          style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}
        >
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.5V8L10.5 9.5" />
        </svg>
      </span>
    );
  }

  if (type === 'voicemail') {
    return (
      <span
        style={{
          width: 16,
          height: 16,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          focusable="false"
          style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}
        >
          <circle cx="5" cy="8" r="2.5" />
          <circle cx="11" cy="8" r="2.5" />
          <path d="M7.5 10.5h1" />
        </svg>
      </span>
    );
  }

  if (type === 'queue') {
    return (
      <span
        style={{
          width: 16,
          height: 16,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          focusable="false"
          style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}
        >
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="8" cy="6" r="1.5" />
          <circle cx="12" cy="4" r="1.5" />
          <line x1="4" y1="5.5" x2="4" y2="10" />
          <line x1="8" y1="7.5" x2="8" y2="10" />
          <line x1="12" y1="5.5" x2="12" y2="10" />
          <line x1="4" y1="10" x2="12" y2="10" />
        </svg>
      </span>
    );
  }

  if (type !== 'menu') return null;
  return (
    <span
      style={{
        width: 16,
        height: 16,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 16 16"
        focusable="false"
        style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}
      >
        <rect x="2" y="2" width="4" height="4" rx="1" />
        <rect x="10" y="2" width="4" height="4" rx="1" />
        <rect x="2" y="10" width="4" height="4" rx="1" />
        <rect x="10" y="10" width="4" height="4" rx="1" />
      </svg>
    </span>
  );
}
