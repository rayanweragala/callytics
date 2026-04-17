import type { Edge, Node } from 'reactflow';
import type { BuilderNodeType, FlowDetail, FlowNodeData, FlowSnapshot } from '../types';

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
export const conditionValues = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'timeout', 'invalid', 'default'];
export const SUBFLOW_JUMP_NODE_ID_PREFIX = '__submenu_jump_anchor__';
const GHOST_BRANCH_HEADER_OFFSET = 90;
const GHOST_BRANCH_ROW_STRIDE = 28;
const GHOST_NODE_HALF_HEIGHT = 18;

export const palette: Array<{ type: BuilderNodeType; label: string }> = [
  { type: 'start', label: 'start' },
  { type: 'play_audio', label: 'play audio' },
  { type: 'get_digits', label: 'get digits' },
  { type: 'menu', label: 'Menu Group' },
  { type: 'transfer', label: 'transfer' },
  { type: 'hunt', label: 'Hunt Group' },
  { type: 'hangup', label: 'hangup' },
];

export const miniMapSizeProps = { width: 160, height: 120 } as unknown as Record<string, number>;

// ─── Menu helpers ─────────────────────────────────────────────────────────────

export function sanitizeMenuBranches(value: unknown): string[] {
  if (!Array.isArray(value)) return ['1', '2'];
  const branches = value.map((item) => String(item || '').trim()).filter((item) => menuRoutableBranchSet.has(item));
  return branches.length > 0 ? Array.from(new Set(branches)) : ['1', '2'];
}

export function sanitizeMenuSubmenuTargets(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([branch, target]) => [String(branch || '').trim(), String(target || '').trim()] as const)
    .filter(([branch, target]) => menuRoutableBranchSet.has(branch) && Boolean(target));
  return Object.fromEntries(entries);
}

export function resolveMenuBranchValue(
  branchKey: string | null | undefined,
  condition: string | null | undefined,
): string | null {
  const resolved = String(condition || branchKey || '').trim();
  return menuRoutableBranchSet.has(resolved) ? resolved : null;
}

// ─── Node dimension helpers ───────────────────────────────────────────────────

export function resolveNodeDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

// ─── Node creation ────────────────────────────────────────────────────────────

export function typeConfig(type: BuilderNodeType): Record<string, unknown> {
  if (type === 'play_audio') return { audio_file_path: '', audio_file_id: '' };
  if (type === 'get_digits') return { timeout_ms: 5000, prompt_path: '', prompt_audio_file_id: '' };
  if (type === 'menu') return {
    timeout_ms: 5000, prompt_path: '', prompt_audio_file_id: '', timeout_prompt_audio_id: '',
    invalid_prompt_audio_id: '', final_failure_audio_id: '', max_timeout_attempts: 3,
    max_invalid_attempts: 3, branches: ['1', '2'], submenu_branch_targets: {},
  };
  if (type === 'transfer') return { destination: '', timeout_ms: 30000, on_no_answer: '' };
  if (type === 'hunt') return {
    destinations: ['SIP/101'], strategy: 'sequential', attempt_timeout_ms: 20000,
    total_timeout_ms: 60000, hold_audio_file_id: null, busy_audio_file_id: null, on_no_answer: '',
  };
  return {};
}

// ─── Serialization ────────────────────────────────────────────────────────────

export function serializeNodeForSave(node: Node<FlowNodeData>) {
  const isGroup = node.data.type === 'group';
  const config = isGroup
    ? { ...node.data.config, width: Math.max(200, resolveNodeDimension(node.width ?? node.style?.width ?? node.data.config.width, 200)), height: Math.max(150, resolveNodeDimension(node.height ?? node.style?.height ?? node.data.config.height, 150)) }
    : node.data.type === 'menu'
      ? { ...node.data.config, branches: sanitizeMenuBranches(node.data.config.branches), submenu_branch_targets: sanitizeMenuSubmenuTargets(node.data.config.submenu_branch_targets) }
      : node.data.config;
  return { nodeKey: node.id, type: node.data.type, label: node.data.label, positionX: node.position.x, positionY: node.position.y, config, groupId: node.parentId ?? null, subflowId: node.data.subflowId ?? null };
}

export function createSavePayload(
  flow: FlowDetail,
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
  versionMessage?: string,
) {
  const nodeTypeMap = new Map(nodes.map((node) => [node.id, node.data.type]));
  const persistedEdges = edges
    .filter((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.source);
      const branchKey = String(edge.data?.branchKey || edge.data?.condition || 'default');
      if (sourceNodeType !== 'menu') return true;
      return branchKey === 'complete' || menuRoutableBranchSet.has(branchKey);
    })
    .map((edge) => ({ sourceNodeKey: edge.source, targetNodeKey: edge.target, branchKey: String(edge.data?.branchKey || edge.data?.condition || 'default'), condition: edge.data?.condition ?? null }));
  return { name: flow.name, description: flow.description || '', slug: flow.slug, versionMessage, nodes: nodes.map(serializeNodeForSave), edges: persistedEdges };
}

export async function validateFlowBeforeSave(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): Promise<string | null> {
  const { getFlow } = await import('../lib/api');
  const nodeTypeMap = new Map(nodes.map((node) => [node.id, node.data.type]));
  const persistedEdges = edges
    .filter((edge) => { const sourceNodeType = nodeTypeMap.get(edge.source); const branchKey = String(edge.data?.branchKey || edge.data?.condition || 'default'); if (sourceNodeType !== 'menu') return true; return branchKey === 'complete' || menuRoutableBranchSet.has(branchKey); })
    .map((edge) => ({ sourceNodeKey: edge.source, targetNodeKey: edge.target, branchKey: String(edge.data?.branchKey || edge.data?.condition || 'default'), condition: edge.data?.condition ?? null }));
  const sourceOutgoing = new Map<string, Array<{ branchKey: string; condition: string | null }>>();
  for (const edge of persistedEdges) { const current = sourceOutgoing.get(edge.sourceNodeKey) || []; current.push({ branchKey: edge.branchKey, condition: edge.condition }); sourceOutgoing.set(edge.sourceNodeKey, current); }
  const subflowNodeKeysById = new Map<number, Set<string>>();
  async function loadSubflowNodeKeys(subflowId: number): Promise<Set<string> | null> {
    if (subflowNodeKeysById.has(subflowId)) return subflowNodeKeysById.get(subflowId) || null;
    try { const response = await getFlow(String(subflowId)); const nodeKeys = new Set(response.data.nodes.map((item) => item.nodeKey)); subflowNodeKeysById.set(subflowId, nodeKeys); return nodeKeys; } catch { return null; }
  }
  for (const node of nodes) {
    if (node.data.type !== 'menu') continue;
    const configuredBranches = sanitizeMenuBranches(node.data.config.branches);
    const submenuTargets = sanitizeMenuSubmenuTargets(node.data.config.submenu_branch_targets);
    const subflowId = Number(node.data.subflowId || 0);
    if (subflowId <= 0) continue;
    const outgoing = sourceOutgoing.get(node.id) || [];
    const routedBranches = new Set(outgoing.map((item) => String(item.condition || item.branchKey || '').trim()).filter((item) => menuRoutableBranchSet.has(item)));
    const missing: string[] = [];
    for (const branch of configuredBranches) {
      if (routedBranches.has(branch)) continue;
      const submenuTarget = String(submenuTargets[branch] || '').trim();
      if (!submenuTarget) { missing.push(branch); continue; }
      const nodeKeys = await loadSubflowNodeKeys(subflowId);
      if (!nodeKeys) return `Menu "${node.data.label || node.id}" points to submenu #${subflowId}, but it could not be loaded.`;
      if (!nodeKeys.has(submenuTarget)) return `Menu "${node.data.label || node.id}" maps branch "${branch}" to missing submenu node "${submenuTarget}".`;
    }
    if (missing.length > 0) return `Menu "${node.data.label || node.id}" is missing route(s) for: ${missing.join(', ')}.`;
  }
  for (const node of nodes) {
    if (node.data.type === 'hangup' || node.data.type === 'group' || node.data.type === 'menu' || node.data.type === 'play_audio' || node.data.type === 'transfer' || node.data.type === 'hunt') continue;
    const outgoingCount = (sourceOutgoing.get(node.id) || []).length;
    if (outgoingCount === 0) return `Node "${node.data.label || node.id}" (${node.data.type}) has no outgoing path.`;
  }
  return null;
}

export function buildEditorSnapshot(flow: FlowDetail | null, nodes: Array<Node<FlowNodeData>>, edges: Array<Edge<BuilderEdgeData>>): string {
  if (!flow) return '';
  return JSON.stringify(createSavePayload(flow, nodes, edges));
}

// ─── Draft flow ───────────────────────────────────────────────────────────────

export function createDraftFlow(): FlowDetail {
  const now = new Date().toISOString();
  return { id: 0, name: 'Untitled Flow', description: 'New flow', slug: 'untitled-flow', parentFlowId: null, parentNodeKey: null, createdAt: now, updatedAt: now, versionId: 0, versionNumber: 0, nodes: [], edges: [] };
}

// ─── Auto-layout ──────────────────────────────────────────────────────────────

const AUTO_LAYOUT_DEFAULT_NODE_HEIGHT = 72;
const AUTO_LAYOUT_MENU_BASE_HEIGHT = 160;
const AUTO_LAYOUT_MENU_BRANCH_ROW_HEIGHT = 28;
const AUTO_LAYOUT_VERTICAL_GAP = 80;

function resolveAutoLayoutNodeHeight(node: Node<FlowNodeData>): number {
  if (node.data.type !== 'menu') return AUTO_LAYOUT_DEFAULT_NODE_HEIGHT;
  const branchCount = Array.isArray(node.data.config.branches) ? node.data.config.branches.map((value) => String(value || '').trim()).filter(Boolean).length : 2;
  return AUTO_LAYOUT_MENU_BASE_HEIGHT + Math.max(2, branchCount) * AUTO_LAYOUT_MENU_BRANCH_ROW_HEIGHT;
}

function shouldAutoArrange(nodes: Array<Node<FlowNodeData>>): boolean {
  if (nodes.length <= 1) return false;
  const xValues = nodes.map((node) => node.position.x);
  const yValues = nodes.map((node) => node.position.y);
  return Math.max(...xValues) - Math.min(...xValues) < 300 && Math.max(...yValues) - Math.min(...yValues) < 300;
}

export function applyAutoLayout(nodes: Array<Node<FlowNodeData>>, panelWidth: number): Array<Node<FlowNodeData>> {
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
  const groups = flow.nodes.filter((node) => node.type === 'group').map((node) => ({
    id: node.nodeKey, type: 'group', position: { x: node.positionX, y: node.positionY },
    data: { label: node.label || node.nodeKey, type: node.type, config: node.config },
    style: { width: Math.max(200, resolveNodeDimension(node.config.width, 200)), height: Math.max(150, resolveNodeDimension(node.config.height, 150)) },
    draggable: true, selectable: true,
  }));
  const childNodes = flow.nodes.filter((node) => node.type !== 'group').map((node) => ({
    id: node.nodeKey,
    type: node.type === 'hunt' ? 'huntNode' : node.type === 'menu' ? 'menuNode' : 'flowNode',
    position: { x: node.positionX, y: node.positionY },
    data: { label: node.label || node.nodeKey, type: node.type, config: node.type === 'menu' ? { ...node.config, branches: sanitizeMenuBranches(node.config.branches) } : node.config, subflowId: node.subflowId },
    parentId: node.groupId || undefined,
    extent: node.groupId ? 'parent' as const : undefined,
    draggable: true, selectable: true,
  }));
  return [...groups, ...childNodes];
}

export function mapFlowToEdges(flow: FlowDetail): Edge<BuilderEdgeData>[] {
  const nodeTypeMap = new Map(flow.nodes.map((node) => [node.nodeKey, node.type]));
  return flow.edges
    .filter((edge) => { const sourceNodeType = nodeTypeMap.get(edge.sourceNodeKey) || 'hangup'; if (sourceNodeType !== 'menu') return true; const branchKey = edge.condition || edge.branchKey || ''; return branchKey === 'complete' || menuRoutableBranchSet.has(branchKey); })
    .map((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.sourceNodeKey) || 'hangup';
      const sourceHandle = sourceNodeType === 'menu' ? (edge.condition || edge.branchKey || undefined) : sourceNodeType === 'get_digits' ? (edge.condition || undefined) : undefined;
      return { id: String(edge.id), source: edge.sourceNodeKey, target: edge.targetNodeKey, sourceHandle, label: undefined, type: 'flowEdge', selectable: true, reconnectable: true, data: { branchKey: edge.branchKey, condition: edge.condition, sourceNodeType }, style: { stroke: 'var(--border-strong)' } };
    });
}

// ─── Snapshot → canvas mapping ────────────────────────────────────────────────

export function mapSnapshotToNodes(snapshot: FlowSnapshot): Array<Node<FlowNodeData>> {
  const flowLike: FlowDetail = {
    id: 0, name: '', description: null, slug: '', parentFlowId: null, parentNodeKey: null, createdAt: '', updatedAt: '', versionId: 0, versionNumber: 0,
    nodes: snapshot.nodes.map((node, index) => ({ id: index + 1, nodeKey: node.nodeKey, type: node.type, label: node.label, positionX: node.positionX, positionY: node.positionY, config: node.config, groupId: node.groupId, subflowId: node.subflowId })),
    edges: [],
  };
  return mapFlowToNodes(flowLike);
}

export function mapSnapshotToEdges(snapshot: FlowSnapshot): Edge<BuilderEdgeData>[] {
  const flowLike: FlowDetail = {
    id: 0, name: '', description: null, slug: '', parentFlowId: null, parentNodeKey: null, createdAt: '', updatedAt: '', versionId: 0, versionNumber: 0,
    nodes: snapshot.nodes.map((node, index) => ({ id: index + 1, nodeKey: node.nodeKey, type: node.type, label: node.label, positionX: node.positionX, positionY: node.positionY, config: node.config, groupId: node.groupId, subflowId: node.subflowId })),
    edges: snapshot.edges.map((edge, index) => ({ id: index + 1, sourceNodeKey: edge.sourceNodeKey, targetNodeKey: edge.targetNodeKey, branchKey: edge.branchKey, condition: edge.condition })),
  };
  return mapFlowToEdges(flowLike);
}

// ─── Subflow jump visuals ─────────────────────────────────────────────────────

export function buildSubflowJumpVisuals(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): { nodes: Array<Node<FlowNodeData>>; edges: Array<Edge<BuilderEdgeData>> } {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const localMenuEdgeBranches = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode || sourceNode.data.type !== 'menu') continue;
    const branch = resolveMenuBranchValue(edge.data?.branchKey, edge.data?.condition);
    if (!branch) continue;
    const set = localMenuEdgeBranches.get(edge.source) || new Set<string>();
    set.add(branch); localMenuEdgeBranches.set(edge.source, set);
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
      const anchorY = absolutePosition.y + GHOST_BRANCH_HEADER_OFFSET + branchIndex * GHOST_BRANCH_ROW_STRIDE - GHOST_NODE_HALF_HEIGHT;
      const jumpTargetLabel = subflowId > 0 ? `subflow #${subflowId}:${targetNodeKey}` : `submenu:${targetNodeKey}`;
      visualNodes.push({ id: anchorId, position: { x: anchorX, y: anchorY }, draggable: false, selectable: false, connectable: false, data: { label: jumpTargetLabel, type: 'hangup', config: {} }, style: { width: 176, padding: '10px 12px', border: '1px dashed var(--color-info)', borderRadius: '8px', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontFamily: "'Space Mono', monospace", fontSize: '11px' } });
      visualEdges.push({ id: `submenu-jump-edge::${menuNode.id}::${branch}`, source: menuNode.id, target: anchorId, sourceHandle: branch, reconnectable: false, type: 'flowEdge', data: { branchKey: branch, condition: branch, sourceNodeType: 'menu', isSubflowJump: true } });
    }
  }
  return { nodes: visualNodes, edges: visualEdges };
}

// ─── Version diff utilities ───────────────────────────────────────────────────

export function makeVersionEdgeKey(edge: { source: string; target: string; data?: { branchKey?: string | null; condition?: string | null } }): string {
  return `${edge.source}|${edge.target}|${edge.data?.branchKey || ''}|${edge.data?.condition || ''}`;
}

export function decorateDiffNodes(nodes: Array<Node<FlowNodeData>>, nodeIds: Set<string>, colorVar: string): Array<Node<FlowNodeData>> {
  return nodes.map((node) => nodeIds.has(node.id) ? { ...node, style: { ...node.style, borderLeft: `2px solid var(${colorVar})` } } : node);
}

export function decorateDiffEdges(edges: Array<Edge<BuilderEdgeData>>, changedKeys: Set<string>): Array<Edge<BuilderEdgeData>> {
  return edges.map((edge) => changedKeys.has(makeVersionEdgeKey(edge))
    ? { ...edge, type: undefined, style: { stroke: 'var(--color-warning)', strokeWidth: 2 }, markerEnd: undefined }
    : { ...edge, type: undefined, style: { stroke: 'var(--border-strong)', strokeWidth: 1.5 }, markerEnd: undefined },
  );
}

// ─── Minimap / palette UI helpers ─────────────────────────────────────────────

export function minimapNodeColor(node: Node<FlowNodeData>): string {
  switch (node.data?.type) {
    case 'start': return 'var(--accent)';
    case 'play_audio': return 'var(--color-info)';
    case 'get_digits': return 'var(--color-warning)';
    case 'menu': return 'var(--color-warning)';
    case 'transfer': return 'var(--color-info)';
    case 'hunt': return 'var(--color-warning)';
    case 'hangup': return 'var(--color-error)';
    case 'group': return 'var(--accent)';
    default: return 'var(--text-muted)';
  }
}

export function renderPaletteIcon(type: BuilderNodeType) {
  if (type !== 'menu') return null;
  return (
    <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }} aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false" style={{ width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 }}>
        <rect x="2" y="2" width="4" height="4" rx="1" />
        <rect x="10" y="2" width="4" height="4" rx="1" />
        <rect x="2" y="10" width="4" height="4" rx="1" />
        <rect x="10" y="10" width="4" height="4" rx="1" />
      </svg>
    </span>
  );
}
