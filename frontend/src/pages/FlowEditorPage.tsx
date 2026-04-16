import { getApiError } from '../lib/apiError';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeMouseHandler,
  MiniMap,
  Node,
  NodeDragHandler,
  OnSelectionChangeParams,
  ReactFlowInstance,
  reconnectEdge,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import {
  createFlow,
  createFlowVersion,
  getFlow,
  getFlowBreadcrumb,
  getFlowTree,
  getFlowVersion,
  listAudio,
  listFlowVersions,
  restoreFlowVersion,
  updateFlow,
} from '../lib/api';
import type { AudioFileItem, BuilderNodeType, FlowBreadcrumbItem, FlowDetail, FlowNodeData, FlowSnapshot, FlowTree, FlowVersionDetail, FlowVersionSummary } from '../types';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { FlowBreadcrumb } from '../components/FlowBreadcrumb';
import { FlowTreePanel } from '../components/FlowTreePanel';
import { FlowCanvasEdge } from '../components/builder/FlowCanvasEdge';
import { FlowCanvasNode } from '../components/builder/FlowCanvasNode';
import { FlowGroupNode } from '../components/builder/FlowGroupNode';
import { HuntNode } from '../components/nodes/HuntNode';
import { MenuGroupNode } from '../components/nodes/MenuGroupNode';
import { HuntConfigPanel } from '../components/panels/HuntConfigPanel';
import { layoutFlow } from '../utils/layoutFlow';
import { formatDateTime } from '../lib/time';
import styles from './FlowEditorPage.module.css';

const nodeTypes = {
  flowNode: FlowCanvasNode,
  huntNode: HuntNode,
  menuNode: MenuGroupNode,
  group: FlowGroupNode,
};

const edgeTypes = {
  flowEdge: FlowCanvasEdge,
};

const palette: Array<{ type: BuilderNodeType; label: string }> = [
  { type: 'start', label: 'start' },
  { type: 'play_audio', label: 'play audio' },
  { type: 'get_digits', label: 'get digits' },
  { type: 'menu', label: 'Menu Group' },
  { type: 'transfer', label: 'transfer' },
  { type: 'hunt', label: 'Hunt Group' },
  { type: 'hangup', label: 'hangup' },
];

const conditionValues = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'timeout', 'invalid', 'default'];
const menuBranchOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
const menuRoutableBranchSet = new Set(menuBranchOptions);
const AUTO_SAVE_DEBOUNCE_MS = 1200;
const SUBFLOW_JUMP_NODE_ID_PREFIX = '__submenu_jump_anchor__';
const GHOST_BRANCH_HEADER_OFFSET = 90;  // px from menu node top to the centre of the first branch row
const GHOST_BRANCH_ROW_STRIDE    = 28;  // px per branch row (22px min-height + 6px gap)
const GHOST_NODE_HALF_HEIGHT     = 18;  // half the ghost node rendered height (for vertical centering)

function sanitizeMenuBranches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['1', '2'];
  }

  const branches = value
    .map((item) => String(item || '').trim())
    .filter((item) => menuRoutableBranchSet.has(item));

  return branches.length > 0 ? Array.from(new Set(branches)) : ['1', '2'];
}

function sanitizeMenuSubmenuTargets(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([branch, target]) => [String(branch || '').trim(), String(target || '').trim()] as const)
    .filter(([branch, target]) => menuRoutableBranchSet.has(branch) && Boolean(target));

  return Object.fromEntries(entries);
}

function resolveMenuBranchValue(
  branchKey: string | null | undefined,
  condition: string | null | undefined,
): string | null {
  const resolved = String(condition || branchKey || '').trim();
  return menuRoutableBranchSet.has(resolved) ? resolved : null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
  isSubflowJump?: boolean;
  subflowJumpLabel?: string;
  onDelete?: (edgeId: string) => void;
};

type PendingLeaveAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'history-back' };

function typeConfig(type: BuilderNodeType): Record<string, unknown> {
  if (type === 'play_audio') return { audio_file_path: '', audio_file_id: '' };
  if (type === 'get_digits') return { timeout_ms: 5000, prompt_path: '', prompt_audio_file_id: '' };
  if (type === 'menu') {
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
  }
  if (type === 'transfer') return { destination: '', timeout_ms: 30000, on_no_answer: '' };
  if (type === 'hunt') {
    return {
      destinations: ['SIP/101'],
      strategy: 'sequential',
      attempt_timeout_ms: 20000,
      total_timeout_ms: 60000,
      hold_audio_file_id: null,
      busy_audio_file_id: null,
      on_no_answer: '',
    };
  }
  return {};
}

function buildCanvasNode(type: BuilderNodeType, index: number): Node<FlowNodeData> {
  const key = `${type}-${Date.now()}-${index}`;
  return {
    id: key,
    type: type === 'hunt' ? 'huntNode' : type === 'menu' ? 'menuNode' : type === 'group' ? 'group' : 'flowNode',
    position: { x: 120 + index * 40, y: 120 + index * 30 },
    data: {
      label: palette.find((item) => item.type === type)?.label || type,
      type,
      config: type === 'group' ? { width: 200, height: 150 } : typeConfig(type),
      subflowId: null,
    },
    style: type === 'group' ? { width: 200, height: 150 } : undefined,
  };
}

function isGroupNode(node: Node<FlowNodeData>): boolean {
  return node.data.type === 'group';
}

function resolveNodeDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return numeric;
}

function serializeNodeForSave(node: Node<FlowNodeData>) {
  const isGroup = node.data.type === 'group';
  const config = isGroup
    ? {
        ...node.data.config,
        width: Math.max(200, resolveNodeDimension(node.width ?? node.style?.width ?? node.data.config.width, 200)),
        height: Math.max(150, resolveNodeDimension(node.height ?? node.style?.height ?? node.data.config.height, 150)),
      }
    : node.data.type === 'menu'
      ? {
          ...node.data.config,
          branches: sanitizeMenuBranches(node.data.config.branches),
          submenu_branch_targets: sanitizeMenuSubmenuTargets(node.data.config.submenu_branch_targets),
        }
      : node.data.config;

  return {
    nodeKey: node.id,
    type: node.data.type,
    label: node.data.label,
    positionX: node.position.x,
    positionY: node.position.y,
    config,
    groupId: node.parentId ?? null,
    subflowId: node.data.subflowId ?? null,
  };
}

function createDraftFlow(): FlowDetail {
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

function createSavePayload(
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
      if (sourceNodeType !== 'menu') {
        return true;
      }

      return branchKey === 'complete' || menuRoutableBranchSet.has(branchKey);
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

async function validateFlowBeforeSave(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): Promise<string | null> {
  const nodeTypeMap = new Map(nodes.map((node) => [node.id, node.data.type]));
  const persistedEdges = edges
    .filter((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.source);
      const branchKey = String(edge.data?.branchKey || edge.data?.condition || 'default');
      if (sourceNodeType !== 'menu') {
        return true;
      }

      return branchKey === 'complete' || menuRoutableBranchSet.has(branchKey);
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
    if (subflowNodeKeysById.has(subflowId)) {
      return subflowNodeKeysById.get(subflowId) || null;
    }
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
    if (node.data.type !== 'menu') {
      continue;
    }

    const configuredBranches = sanitizeMenuBranches(node.data.config.branches);
    const submenuTargets = sanitizeMenuSubmenuTargets(node.data.config.submenu_branch_targets);
    const subflowId = Number(node.data.subflowId || 0);

    // First-save allowance: menu subflows are created only after initial save.
    // Without this, users are blocked from creating menus at all.
    if (subflowId <= 0) {
      continue;
    }

    const outgoing = sourceOutgoing.get(node.id) || [];
    const routedBranches = new Set(
      outgoing
        .map((item) => String(item.condition || item.branchKey || '').trim())
        .filter((item) => menuRoutableBranchSet.has(item)),
    );
    const missing: string[] = [];

    for (const branch of configuredBranches) {
      if (routedBranches.has(branch)) {
        continue;
      }

      const submenuTarget = String(submenuTargets[branch] || '').trim();
      if (!submenuTarget) {
        missing.push(branch);
        continue;
      }

      const nodeKeys = await loadSubflowNodeKeys(subflowId);
      if (!nodeKeys) {
        return `Menu "${node.data.label || node.id}" points to submenu #${subflowId}, but it could not be loaded.`;
      }
      if (!nodeKeys.has(submenuTarget)) {
        return `Menu "${node.data.label || node.id}" maps branch "${branch}" to missing submenu node "${submenuTarget}".`;
      }
    }

    if (missing.length > 0) {
      return `Menu "${node.data.label || node.id}" is missing route(s) for: ${missing.join(', ')}.`;
    }
  }

  for (const node of nodes) {
    if (
      node.data.type === 'hangup'
      || node.data.type === 'group'
      || node.data.type === 'menu'
      || node.data.type === 'play_audio'
    ) {
      continue;
    }
    const outgoingCount = (sourceOutgoing.get(node.id) || []).length;
    if (outgoingCount === 0) {
      return `Node "${node.data.label || node.id}" (${node.data.type}) has no outgoing path.`;
    }
  }

  return null;
}

function buildEditorSnapshot(flow: FlowDetail | null, nodes: Array<Node<FlowNodeData>>, edges: Array<Edge<BuilderEdgeData>>): string {
  if (!flow) {
    return '';
  }

  return JSON.stringify(createSavePayload(flow, nodes, edges));
}

function shouldAutoArrange(nodes: Array<Node<FlowNodeData>>): boolean {
  if (nodes.length <= 1) return false;
  const xValues = nodes.map((node) => node.position.x);
  const yValues = nodes.map((node) => node.position.y);
  const width = Math.max(...xValues) - Math.min(...xValues);
  const height = Math.max(...yValues) - Math.min(...yValues);
  return width < 300 && height < 300;
}

const AUTO_LAYOUT_DEFAULT_NODE_HEIGHT = 72;
const AUTO_LAYOUT_MENU_BASE_HEIGHT = 160;
const AUTO_LAYOUT_MENU_BRANCH_ROW_HEIGHT = 28;
const AUTO_LAYOUT_VERTICAL_GAP = 80;

function resolveAutoLayoutNodeHeight(node: Node<FlowNodeData>): number {
  if (node.data.type !== 'menu') {
    return AUTO_LAYOUT_DEFAULT_NODE_HEIGHT;
  }

  const branchCount = Array.isArray(node.data.config.branches)
    ? node.data.config.branches.map((value) => String(value || '').trim()).filter(Boolean).length
    : 2;

  const activeBranchCount = Math.max(2, branchCount);
  return AUTO_LAYOUT_MENU_BASE_HEIGHT + activeBranchCount * AUTO_LAYOUT_MENU_BRANCH_ROW_HEIGHT;
}

function applyAutoLayout(nodes: Array<Node<FlowNodeData>>, panelWidth: number): Array<Node<FlowNodeData>> {
  if (!shouldAutoArrange(nodes)) {
    return nodes;
  }

  const centerX = Math.max(80, Math.round(panelWidth / 2) - 85);
  let currentY = 80;

  return nodes.map((node) => {
    const nextNode = {
      ...node,
      position: {
        x: centerX,
        y: currentY,
      },
    };
    currentY += resolveAutoLayoutNodeHeight(node) + AUTO_LAYOUT_VERTICAL_GAP;
    return nextNode;
  });
}

function decorateNodes(
  nodes: Array<Node<FlowNodeData>>,
  options: {
    editingGroupId: string | null;
    onDelete: (nodeId: string) => void;
    onGroupLabelChange: (nodeId: string, value: string) => void;
    onGroupLabelSubmit: (nodeId: string) => void;
    onGroupLabelDoubleClick: (nodeId: string) => void;
    onOpenSubmenu: (nodeId: string) => void;
  },
): Array<Node<FlowNodeData>> {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onDelete: node.data.type === 'group' ? undefined : () => options.onDelete(node.id),
      onLabelChange: node.data.type === 'group' || node.data.type === 'menu'
        ? (value: string) => options.onGroupLabelChange(node.id, value)
        : undefined,
      onLabelSubmit: node.data.type === 'group' || node.data.type === 'menu'
        ? () => options.onGroupLabelSubmit(node.id)
        : undefined,
      onLabelDoubleClick: node.data.type === 'group'
        ? () => options.onGroupLabelDoubleClick(node.id)
        : undefined,
      onOpenSubmenu: node.data.type === 'menu' ? () => options.onOpenSubmenu(node.id) : undefined,
      isEditing: node.id === options.editingGroupId,
    },
  }));
}

function getAbsoluteNodePosition(node: Node<FlowNodeData>, nodeMap: Map<string, Node<FlowNodeData>>): { x: number; y: number } {
  if (!node.parentId) {
    return node.position;
  }

  const parent = nodeMap.get(node.parentId);
  if (!parent) {
    return node.position;
  }

  const parentPosition = getAbsoluteNodePosition(parent, nodeMap);
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
}

function getNodeSize(node: Node<FlowNodeData>): { width: number; height: number } {
  return {
    width: resolveNodeDimension(node.width ?? node.style?.width ?? node.data.config.width, 170),
    height: resolveNodeDimension(node.height ?? node.style?.height ?? node.data.config.height, 72),
  };
}

function getContainingGroupNode(node: Node<FlowNodeData>, allNodes: Array<Node<FlowNodeData>>): Node<FlowNodeData> | null {
  const nodeMap = new Map(allNodes.map((item) => [item.id, item]));
  const absolutePosition = getAbsoluteNodePosition(node, nodeMap);
  const { width, height } = getNodeSize(node);
  const centerX = absolutePosition.x + width / 2;
  const centerY = absolutePosition.y + height / 2;

  const groups = allNodes
    .filter((candidate) => isGroupNode(candidate) && candidate.id !== node.id)
    .filter((group) => {
      const groupPosition = getAbsoluteNodePosition(group, nodeMap);
      const groupWidth = Math.max(200, resolveNodeDimension(group.width ?? group.style?.width ?? group.data.config.width, 200));
      const groupHeight = Math.max(150, resolveNodeDimension(group.height ?? group.style?.height ?? group.data.config.height, 150));
      return centerX >= groupPosition.x
        && centerX <= groupPosition.x + groupWidth
        && centerY >= groupPosition.y
        && centerY <= groupPosition.y + groupHeight;
    });

  return groups.length > 0 ? groups[groups.length - 1] : null;
}

function buildSubflowJumpVisuals(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge<BuilderEdgeData>>,
): { nodes: Array<Node<FlowNodeData>>; edges: Array<Edge<BuilderEdgeData>> } {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const localMenuEdgeBranches = new Map<string, Set<string>>();

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode || sourceNode.data.type !== 'menu') {
      continue;
    }
    const branch = resolveMenuBranchValue(edge.data?.branchKey, edge.data?.condition);
    if (!branch) {
      continue;
    }
    const set = localMenuEdgeBranches.get(edge.source) || new Set<string>();
    set.add(branch);
    localMenuEdgeBranches.set(edge.source, set);
  }

  const visualNodes: Array<Node<FlowNodeData>> = [];
  const visualEdges: Array<Edge<BuilderEdgeData>> = [];

  for (const menuNode of nodes) {
    if (menuNode.data.type !== 'menu') {
      continue;
    }

    const configuredBranches = sanitizeMenuBranches(menuNode.data.config.branches);
    const submenuTargets = sanitizeMenuSubmenuTargets(menuNode.data.config.submenu_branch_targets);
    const locallyConnectedBranches = localMenuEdgeBranches.get(menuNode.id) || new Set<string>();
    const absolutePosition = getAbsoluteNodePosition(menuNode, nodeMap);
    const subflowId = Number(menuNode.data.subflowId || 0);

    for (let branchIndex = 0; branchIndex < configuredBranches.length; branchIndex++) {
      const branch = configuredBranches[branchIndex];
      if (locallyConnectedBranches.has(branch)) {
        continue;
      }
      const targetNodeKey = String(submenuTargets[branch] || '').trim();
      if (!targetNodeKey) {
        continue;
      }

      const anchorId = `${SUBFLOW_JUMP_NODE_ID_PREFIX}${menuNode.id}__${branch}`;
      const anchorX = absolutePosition.x + 480;
      const anchorY = absolutePosition.y + GHOST_BRANCH_HEADER_OFFSET + branchIndex * GHOST_BRANCH_ROW_STRIDE - GHOST_NODE_HALF_HEIGHT;
      const jumpTargetLabel = subflowId > 0 ? `subflow #${subflowId}:${targetNodeKey}` : `submenu:${targetNodeKey}`;

      visualNodes.push({
        id: anchorId,
        position: { x: anchorX, y: anchorY },
        draggable: false,
        selectable: false,
        connectable: false,
        data: {
          label: jumpTargetLabel,
          type: 'hangup',
          config: {},
        },
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
        data: {
          branchKey: branch,
          condition: branch,
          sourceNodeType: 'menu',
          isSubflowJump: true,
        },
      });
    }
  }

  return { nodes: visualNodes, edges: visualEdges };
}

function reparentNodeIntoGroup(
  draggedNode: Node<FlowNodeData>,
  targetGroup: Node<FlowNodeData>,
  allNodes: Array<Node<FlowNodeData>>,
): Node<FlowNodeData> {
  const nodeMap = new Map(allNodes.map((item) => [item.id, item]));
  const absolutePosition = getAbsoluteNodePosition(draggedNode, nodeMap);
  const groupPosition = getAbsoluteNodePosition(targetGroup, nodeMap);

  return {
    ...draggedNode,
    parentId: targetGroup.id,
    extent: 'parent',
    position: {
      x: absolutePosition.x - groupPosition.x,
      y: absolutePosition.y - groupPosition.y,
    },
  };
}

function removeNodeFromGroup(childNode: Node<FlowNodeData>, allNodes: Array<Node<FlowNodeData>>): Node<FlowNodeData> {
  const nodeMap = new Map(allNodes.map((item) => [item.id, item]));
  const absolutePosition = getAbsoluteNodePosition(childNode, nodeMap);
  return {
    ...childNode,
    parentId: undefined,
    extent: undefined,
    position: absolutePosition,
  };
}

function attachEdgeMetadata(
  edges: Edge<BuilderEdgeData>[],
  nodes: Array<Node<FlowNodeData>>,
  onDelete: (edgeId: string) => void,
): Edge<BuilderEdgeData>[] {
  const grouped = new Map<string, Edge<BuilderEdgeData>[]>();

  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}`;
    const existing = grouped.get(key) || [];
    existing.push(edge);
    grouped.set(key, existing);
  }

  return edges.map((edge) => {
    const sourceNodeType = nodes.find((node) => node.id === edge.source)?.data.type || 'hangup';
    const condition = edge.data?.condition ?? null;
    const siblings = grouped.get(`${edge.source}|${edge.target}`) || [edge];
    const parallelIndex = siblings.findIndex((sibling) => sibling.id === edge.id);
    return {
      ...edge,
      type: 'flowEdge',
      selectable: true,
      reconnectable: true,
      label: undefined,
      data: {
        branchKey: edge.data?.branchKey || condition || 'default',
        condition,
        sourceNodeType,
        parallelIndex,
        parallelTotal: siblings.length,
        onDelete: () => onDelete(edge.id),
      },
      style: { stroke: edge.selected ? 'var(--color-active)' : 'var(--border-strong)' },
    };
  });
}

function mapFlowToNodes(flow: FlowDetail): Array<Node<FlowNodeData>> {
  const groups = flow.nodes
    .filter((node) => node.type === 'group')
    .map((node) => ({
      id: node.nodeKey,
      type: 'group',
      position: { x: node.positionX, y: node.positionY },
      data: {
        label: node.label || node.nodeKey,
        type: node.type,
        config: node.config,
      },
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
        config: node.type === 'menu'
          ? {
              ...node.config,
              branches: sanitizeMenuBranches(node.config.branches),
            }
          : node.config,
        subflowId: node.subflowId,
      },
      parentId: node.groupId || undefined,
      extent: node.groupId ? 'parent' as const : undefined,
      draggable: true,
      selectable: true,
    }));

  return [...groups, ...childNodes];
}

function mapFlowToEdges(flow: FlowDetail): Edge<BuilderEdgeData>[] {
  const nodeTypeMap = new Map(flow.nodes.map((node) => [node.nodeKey, node.type]));
  return flow.edges
    .filter((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.sourceNodeKey) || 'hangup';
      if (sourceNodeType !== 'menu') {
        return true;
      }

      const branchKey = edge.condition || edge.branchKey || '';
      return branchKey === 'complete' || menuRoutableBranchSet.has(branchKey);
    })
    .map((edge) => {
      const sourceNodeType = nodeTypeMap.get(edge.sourceNodeKey) || 'hangup';
      const sourceHandle = sourceNodeType === 'menu'
        ? (edge.condition || edge.branchKey || undefined)
        : sourceNodeType === 'get_digits'
          ? (edge.condition || undefined)
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
        data: {
          branchKey: edge.branchKey,
          condition: edge.condition,
          sourceNodeType,
        },
        style: { stroke: 'var(--border-strong)' },
      };
    });
}

function mapSnapshotToNodes(snapshot: FlowSnapshot): Array<Node<FlowNodeData>> {
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
    nodes: snapshot.nodes.map((node, index) => ({
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

function mapSnapshotToEdges(snapshot: FlowSnapshot): Edge<BuilderEdgeData>[] {
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
    nodes: snapshot.nodes.map((node, index) => ({
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
    edges: snapshot.edges.map((edge, index) => ({
      id: index + 1,
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      branchKey: edge.branchKey,
      condition: edge.condition,
    })),
  };
  return mapFlowToEdges(flowLike);
}

function makeVersionEdgeKey(edge: { source: string; target: string; data?: { branchKey?: string | null; condition?: string | null } }): string {
  return `${edge.source}|${edge.target}|${edge.data?.branchKey || ''}|${edge.data?.condition || ''}`;
}

function decorateDiffNodes(nodes: Array<Node<FlowNodeData>>, nodeIds: Set<string>, colorVar: string): Array<Node<FlowNodeData>> {
  return nodes.map((node) => (
    nodeIds.has(node.id)
      ? {
          ...node,
          style: {
            ...node.style,
            borderLeft: `2px solid var(${colorVar})`,
          },
        }
      : node
  ));
}

function decorateDiffEdges(edges: Array<Edge<BuilderEdgeData>>, changedKeys: Set<string>): Array<Edge<BuilderEdgeData>> {
  return edges.map((edge) => (
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
  ));
}

function makeEdgeKey(source: string | null, target: string | null, sourceHandle: string | null | undefined, condition: string | null): string {
  return `${source || ''}|${target || ''}|${sourceHandle || ''}|${condition || ''}`;
}

function minimapNodeColor(node: Node<FlowNodeData>): string {
  switch (node.data?.type) {
    case 'start':
      return 'var(--accent)';
    case 'play_audio':
      return 'var(--color-info)';
    case 'get_digits':
      return 'var(--color-warning)';
    case 'menu':
      return 'var(--color-warning)';
    case 'transfer':
      return 'var(--color-info)';
    case 'hunt':
      return 'var(--color-warning)';
    case 'hangup':
      return 'var(--color-error)';
    case 'group':
      return 'var(--accent)';
    default:
      return 'var(--text-muted)';
  }
}

const miniMapSizeProps = { width: 160, height: 120 } as unknown as Record<string, number>;

function renderPaletteIcon(type: BuilderNodeType) {
  if (type !== 'menu') {
    return null;
  }

  return (
    <span className={styles.paletteIcon} aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <rect x="2" y="2" width="4" height="4" rx="1" />
        <rect x="10" y="2" width="4" height="4" rx="1" />
        <rect x="2" y="10" width="4" height="4" rx="1" />
        <rect x="10" y="10" width="4" height="4" rx="1" />
      </svg>
    </span>
  );
}

export function FlowEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isDraftRoute = id === 'new';
  const initialRouteFlowId = Number(id || 0);
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const fitDone = useRef(false);
  const pendingLeaveActionRef = useRef<PendingLeaveAction | null>(null);
  const allowNextPopStateRef = useRef(false);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [currentFlowId, setCurrentFlowId] = useState<number>(initialRouteFlowId > 0 ? initialRouteFlowId : 0);
  const [rootFlowId, setRootFlowId] = useState<number>(initialRouteFlowId > 0 ? initialRouteFlowId : 0);
  const [breadcrumb, setBreadcrumb] = useState<FlowBreadcrumbItem[]>([]);
  const [flowTree, setFlowTree] = useState<FlowTree | null>(null);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = (msg: string | null) => {
    setErrorText(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) errorTimerRef.current = setTimeout(() => setErrorText(null), 6000);
  };

  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSuccess = (id: number | null) => {
    setDeletedId(id);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (id !== null) successTimerRef.current = setTimeout(() => setDeletedId(null), 6000);
  };

  const editorNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showEditorNotice = (msg: string | null) => {
    setEditorNotice(msg);
    if (editorNoticeTimerRef.current) clearTimeout(editorNoticeTimerRef.current);
    if (msg) editorNoticeTimerRef.current = setTimeout(() => setEditorNotice(null), 6000);
  };

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (editorNoticeTimerRef.current) clearTimeout(editorNoticeTimerRef.current);
    };
  }, []);

  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [isDraft, setIsDraft] = useState(isDraftRoute);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdgeData>([]);
  const [audioItems, setAudioItems] = useState<AudioFileItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<FlowVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionMessage, setVersionMessage] = useState('');
  const [versionSaveState, setVersionSaveState] = useState<'idle' | 'saving'>('idle');
  const [versionNotice, setVersionNotice] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<FlowVersionSummary | null>(null);
  const [compareVersion, setCompareVersion] = useState<FlowVersionDetail | null>(null);
  const [submenuNodeOptionsLoading, setSubmenuNodeOptionsLoading] = useState(false);
  const [submenuStartNodeKey, setSubmenuStartNodeKey] = useState<string | null>(null);
  const { canvasNodes, canvasEdges } = useMemo(() => {
    const visuals = buildSubflowJumpVisuals(nodes, edges);
    return {
      canvasNodes: [...nodes, ...visuals.nodes],
      canvasEdges: [...edges, ...visuals.edges],
    };
  }, [edges, nodes]);

  useEffect(() => {
    if (!isDraftRoute && initialRouteFlowId > 0) {
      setCurrentFlowId(initialRouteFlowId);
      setRootFlowId(initialRouteFlowId);
    }
    if (isDraftRoute) {
      setBreadcrumb([]);
      setFlowTree(null);
      setRootFlowId(0);
    }
  }, [initialRouteFlowId, isDraftRoute]);

  useEffect(() => {
    if (isDraftRoute || rootFlowId <= 0) {
      setFlowTree(null);
      return;
    }

    let active = true;
    const loadTree = async () => {
      const response = await getFlowTree(rootFlowId);
      if (!active) {
        return;
      }
      setFlowTree(response.data);
    };

    void loadTree();

    return () => {
      active = false;
    };
  }, [isDraftRoute, rootFlowId, treeRefreshKey]);

  useEffect(() => {
    const selectedMenuNode = nodes.find((node) => node.id === selectedNodeId && node.data.type === 'menu') || null;
    if (!selectedMenuNode) {
      setSubmenuNodeOptionsLoading(false);
      setSubmenuStartNodeKey(null);
      return;
    }

    const subflowId = Number(selectedMenuNode.data.subflowId || 0);
    if (subflowId <= 0) {
      setSubmenuNodeOptionsLoading(false);
      setSubmenuStartNodeKey(null);
      return;
    }

    let active = true;
    setSubmenuNodeOptionsLoading(true);
    const loadSubmenuNodes = async () => {
      try {
        const response = await getFlow(String(subflowId));
        if (!active) {
          return;
        }
        const defaultSubmenuStart = response.data.nodes.find((item) => item.type === 'start')?.nodeKey
          || response.data.nodes.find((item) => item.type !== 'group')?.nodeKey
          || null;
        setSubmenuStartNodeKey(defaultSubmenuStart);
      } catch {
        if (!active) {
          return;
        }
        setSubmenuStartNodeKey(null);
      } finally {
        if (active) {
          setSubmenuNodeOptionsLoading(false);
        }
      }
    };

    void loadSubmenuNodes();

    return () => {
      active = false;
    };
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    const selectedMenuNode = nodes.find((node) => node.id === selectedNodeId && node.data.type === 'menu') || null;
    if (!selectedMenuNode) {
      return;
    }

    const localEdgeBranches = new Set(
      edges
        .filter((edge) => edge.source === selectedMenuNode.id)
        .map((edge) => resolveMenuBranchValue(edge.data?.branchKey, edge.data?.condition))
        .filter((value): value is string => Boolean(value)),
    );

    setNodes((current) => {
      const currentNode = current.find((node) => node.id === selectedMenuNode.id && node.data.type === 'menu');
      if (!currentNode) {
        return current;
      }

      const configuredBranches = sanitizeMenuBranches(currentNode.data.config.branches);
      const currentTargets = sanitizeMenuSubmenuTargets(currentNode.data.config.submenu_branch_targets);
      const nextTargets = { ...currentTargets };
      let changed = false;

      for (const branch of Object.keys(nextTargets)) {
        if (localEdgeBranches.has(branch)) {
          delete nextTargets[branch];
          changed = true;
        }
      }

      if (submenuStartNodeKey) {
        for (const branch of configuredBranches) {
          if (localEdgeBranches.has(branch)) {
            continue;
          }
          if (nextTargets[branch]) {
            continue;
          }
          nextTargets[branch] = submenuStartNodeKey;
          changed = true;
        }
      }

      if (!changed) {
        return current;
      }

      return decorateEditorNodes(
        current.map((node) => (
          node.id === currentNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  config: {
                    ...node.data.config,
                    submenu_branch_targets: nextTargets,
                  },
                },
              }
            : node
        )),
      );
    });
  }, [edges, nodes, selectedNodeId, submenuStartNodeKey]);

  useEffect(() => {
    if (rfInstance && nodes.length > 0 && !fitDone.current) {
      fitDone.current = true;
      const timer = window.setTimeout(() => {
        void rfInstance.fitView({ padding: 0.2, duration: 300 });
      }, 100);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [rfInstance, nodes.length]);

  const handleOpenSubmenu = useCallback(async (nodeId: string) => {
    if (isDraftRoute || currentFlowId <= 0) {
      showEditorNotice('Save this flow before opening a submenu.');
      return;
    }

    try {
      const response = await getFlow(String(currentFlowId));
      const menuNode = response.data.nodes.find((node) => node.nodeKey === nodeId);
      const subflowId = Number(menuNode?.subflowId || 0);

      if (!subflowId) {
        showEditorNotice('Menu subflow is missing. Save the flow and try again.');
        return;
      }

      showEditorNotice(null);
      setBreadcrumb((current) => {
        const currentLabel = flow?.name || response.data.name;
        const existingIndex = current.findIndex((item) => item.flowId === currentFlowId);
        const base = existingIndex >= 0 ? current.slice(0, existingIndex + 1) : [...current, { flowId: currentFlowId, flowName: currentLabel }];
        return [...base, { flowId: subflowId, flowName: menuNode?.label || 'Menu' }];
      });
      setCurrentFlowId(subflowId);
    } catch {
      showEditorNotice('Failed to open submenu.');
    }
  }, [currentFlowId, flow?.name, isDraftRoute]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((current) => {
      const target = current.find((node) => node.id === nodeId);
      if (!target || target.data.type === 'start') {
        return current;
      }

      if (target.data.type === 'group') {
        const nextNodes = current.flatMap((node) => {
          if (node.id === nodeId) {
            return [];
          }

          if (node.parentId !== nodeId) {
            return [node];
          }

          return [removeNodeFromGroup(node, current)];
        });

        return decorateNodes(nextNodes, {
          editingGroupId: editingGroupId === nodeId ? null : editingGroupId,
          onDelete: deleteNode,
          onGroupLabelChange: handleGroupLabelChange,
          onGroupLabelSubmit: handleGroupLabelSubmit,
          onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
          onOpenSubmenu: handleOpenSubmenu,
        });
      }

      return decorateNodes(
        current.filter((node) => node.id !== nodeId),
        {
          editingGroupId,
          onDelete: deleteNode,
          onGroupLabelChange: handleGroupLabelChange,
          onGroupLabelSubmit: handleGroupLabelSubmit,
          onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
          onOpenSubmenu: handleOpenSubmenu,
        },
      );
    });
    setEdges((current) => attachEdgeMetadata(current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId), nodes, deleteEdge));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setSelectedNodeIds((current) => current.filter((value) => value !== nodeId));
  }, [editingGroupId, nodes]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
  }, [setEdges]);

  function handleGroupLabelChange(nodeId: string, value: string) {
    setNodes((current) =>
      decorateNodes(
        current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, label: value } } : node)),
        {
          editingGroupId: nodeId,
          onDelete: deleteNode,
          onGroupLabelChange: handleGroupLabelChange,
          onGroupLabelSubmit: handleGroupLabelSubmit,
          onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
          onOpenSubmenu: handleOpenSubmenu,
        },
      ),
    );
  }

  function handleGroupLabelSubmit(nodeId: string) {
    setEditingGroupId((current) => (current === nodeId ? null : current));
    setNodes((current) =>
      decorateNodes(current, {
        editingGroupId: null,
        onDelete: deleteNode,
        onGroupLabelChange: handleGroupLabelChange,
        onGroupLabelSubmit: handleGroupLabelSubmit,
        onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
        onOpenSubmenu: handleOpenSubmenu,
      }),
    );
  }

  function handleGroupLabelDoubleClick(nodeId: string) {
    setEditingGroupId(nodeId);
    setNodes((current) =>
      decorateNodes(current, {
        editingGroupId: nodeId,
        onDelete: deleteNode,
        onGroupLabelChange: handleGroupLabelChange,
        onGroupLabelSubmit: handleGroupLabelSubmit,
        onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
        onOpenSubmenu: handleOpenSubmenu,
      }),
    );
  }

  const decorateEditorNodes = useCallback((nextNodes: Array<Node<FlowNodeData>>, nextEditingGroupId: string | null = editingGroupId) => (
    decorateNodes(nextNodes, {
      editingGroupId: nextEditingGroupId,
      onDelete: deleteNode,
      onGroupLabelChange: handleGroupLabelChange,
      onGroupLabelSubmit: handleGroupLabelSubmit,
      onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
      onOpenSubmenu: handleOpenSubmenu,
    })
  ), [deleteNode, editingGroupId]);

  useEffect(() => {
    const loadAudio = async () => {
      const response = await listAudio(1, 100);
      setAudioItems(response.data);
    };
    void loadAudio();
  }, []);

  useEffect(() => {
    fitDone.current = false;
    setIsInitialized(false);
    setIsDraft(isDraftRoute);
    let active = true;

    const load = async () => {
      if (isDraftRoute) {
        const draftFlow = createDraftFlow();
        const draftNodes = decorateEditorNodes([
          {
            id: 'start',
            type: 'flowNode',
            position: { x: 120, y: 140 },
            data: {
              label: 'Start',
              type: 'start',
              config: {},
              subflowId: null,
            },
            draggable: false,
          },
        ], null);
        if (!active) {
          return;
        }
        setFlow(draftFlow);
        setBreadcrumb([]);
        setNodes(draftNodes);
        setEdges([]);
        setSavedSnapshot(null);
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedEdgeId(null);
        setEditingGroupId(null);
        setIsInitialized(true);
        return;
      }

      if (currentFlowId <= 0) {
        return;
      }

      const [response, breadcrumbResponse] = await Promise.all([
        getFlow(String(currentFlowId)),
        getFlowBreadcrumb(currentFlowId),
      ]);
      if (!active) {
        return;
      }
      setFlow(response.data);
      setBreadcrumb(breadcrumbResponse.data);
      const panelWidth = canvasPanelRef.current?.clientWidth || 900;
      const mappedNodes = mapFlowToNodes(response.data);
      const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
      const nextNodes = decorateEditorNodes(arrangedNodes, null);
      const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, deleteEdge);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setEditingGroupId(null);
      setIsInitialized(true);
    };

    void load();

    return () => {
      active = false;
    };
  }, [currentFlowId, isDraftRoute]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) || null,
    [edges, selectedEdgeId],
  );

  const selectedEdgeSourceNode = useMemo(
    () => (selectedEdge ? nodes.find((node) => node.id === selectedEdge.source) || null : null),
    [nodes, selectedEdge],
  );

  const selectedCanvasNodes = useMemo(
    () => nodes.filter((node) => selectedNodeIds.includes(node.id)),
    [nodes, selectedNodeIds],
  );

  const selectedGroupNode = useMemo(() => {
    if (selectedCanvasNodes.length !== 1) {
      return null;
    }
    return isGroupNode(selectedCanvasNodes[0]) ? selectedCanvasNodes[0] : null;
  }, [selectedCanvasNodes]);

  const groupableSelection = useMemo(
    () => selectedCanvasNodes.filter((node) => !isGroupNode(node) && !node.parentId),
    [selectedCanvasNodes],
  );

  const canGroupSelection = groupableSelection.length >= 2 && groupableSelection.length === selectedCanvasNodes.length;
  const canUngroupSelection = Boolean(selectedGroupNode);
  const selectedChildNode = selectedCanvasNodes.length === 1 && !isGroupNode(selectedCanvasNodes[0]) && selectedCanvasNodes[0].parentId
    ? selectedCanvasNodes[0]
    : null;
  const canRemoveFromGroupSelection = Boolean(selectedChildNode);

  const hasUnsavedChanges = useMemo(() => {
    if (!isInitialized || !flow) {
      return false;
    }

    if (isDraft) {
      return true;
    }

    if (savedSnapshot === null) {
      return false;
    }

    return buildEditorSnapshot(flow, nodes, edges) !== savedSnapshot;
  }, [edges, flow, isDraft, isInitialized, nodes, savedSnapshot]);


  useEffect(() => {
    if (!versionsOpen || !flow || isDraft || flow.id <= 0) {
      return;
    }

    let active = true;
    setVersionsLoading(true);
    void listFlowVersions(flow.id)
      .then((response) => {
        if (active) {
          setVersions(response.data);
        }
      })
      .finally(() => {
        if (active) {
          setVersionsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [flow, isDraft, versionsOpen]);

  const performLeaveAction = useCallback((action: PendingLeaveAction) => {
    if (action.kind === 'navigate') {
      navigate(action.to);
      return;
    }

    if (action.kind === 'external') {
      window.location.assign(action.href);
      return;
    }

    allowNextPopStateRef.current = true;
    window.history.back();
  }, [navigate]);

  const requestLeave = useCallback((action: PendingLeaveAction) => {
    if (!hasUnsavedChanges) {
      performLeaveAction(action);
      return;
    }

    pendingLeaveActionRef.current = action;
    setConfirmLeaveOpen(true);
  }, [hasUnsavedChanges, performLeaveAction]);

  const handleCancelLeave = useCallback(() => {
    pendingLeaveActionRef.current = null;
    setConfirmLeaveOpen(false);
  }, []);

  const handleConfirmLeave = useCallback(() => {
    const action = pendingLeaveActionRef.current;
    pendingLeaveActionRef.current = null;
    setConfirmLeaveOpen(false);
    if (action) {
      performLeaveAction(action);
    }
  }, [performLeaveAction]);

  useEffect(() => {
    if (!hasUnsavedChanges && confirmLeaveOpen) {
      pendingLeaveActionRef.current = null;
      setConfirmLeaveOpen(false);
    }
  }, [confirmLeaveOpen, hasUnsavedChanges]);

  useEffect(() => {
    const message = 'You have unsaved changes. Leave anyway?';
    if (!hasUnsavedChanges) {
      return;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href === currentPath) {
        return;
      }

      if (anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      event.preventDefault();
      event.stopPropagation();

      if (nextUrl.origin === window.location.origin) {
        requestLeave({ kind: 'navigate', to: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` });
        return;
      }

      requestLeave({ kind: 'external', href: nextUrl.toString() });
    };

    const handlePopState = () => {
      if (allowNextPopStateRef.current) {
        allowNextPopStateRef.current = false;
        return;
      }

      window.history.pushState(null, '', currentPath);
      requestLeave({ kind: 'history-back' });
    };

    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [hasUnsavedChanges, requestLeave]);

  useEffect(() => {
    return () => {
      if (saveFeedbackTimer.current) {
        window.clearTimeout(saveFeedbackTimer.current);
      }
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
      }
    };
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNodeType = nodes.find((node) => node.id === connection.source)?.data.type || 'hangup';
      const menuBranch = sourceNodeType === 'menu' ? String(connection.sourceHandle || 'complete') : null;
      const condition = sourceNodeType === 'get_digits'
        ? 'default'
        : sourceNodeType === 'menu'
          ? menuBranch
          : null;
      const branchKey = sourceNodeType === 'hunt'
        ? 'no answer'
        : sourceNodeType === 'menu'
          ? (menuBranch || 'complete')
          : condition || 'default';
      const newKey = makeEdgeKey(connection.source, connection.target, connection.sourceHandle, condition);

      setEdges((current) => {
        if (sourceNodeType === 'hunt' && current.some((edge) => edge.source === connection.source)) {
          return current;
        }
        const duplicate = current.find((edge) => makeEdgeKey(edge.source, edge.target, edge.sourceHandle, edge.data?.condition ?? null) === newKey);
        if (duplicate) {
          return current;
        }
        const next = addEdge(
            {
              ...connection,
              label: undefined,
              type: 'flowEdge',
              reconnectable: true,
              style: { stroke: 'var(--border-strong)' },
              data: { branchKey, condition, sourceNodeType },
            },
current,
        );
        return attachEdgeMetadata(next, nodes, deleteEdge);
      });
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [deleteEdge, nodes, setEdges],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_event, clickedEdge) => {
      if (clickedEdge.data?.isSubflowJump) {
        return;
      }
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeId(clickedEdge.id);
      setEdges((current) =>
        attachEdgeMetadata(
          current.map((edge) => ({
            ...edge,
            selected: edge.id === clickedEdge.id,
          })),
          nodes,
          deleteEdge,
        ),
      );
    },
    [deleteEdge, nodes, setEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge<BuilderEdgeData>, newConnection: Connection) => {
      const oldCondition = oldEdge.data?.condition ?? null;
      const duplicateKey = makeEdgeKey(newConnection.source, newConnection.target, newConnection.sourceHandle, oldCondition);
      setEdges((current) => {
        const duplicate = current.find((edge) => edge.id !== oldEdge.id && makeEdgeKey(edge.source, edge.target, edge.sourceHandle, edge.data?.condition ?? null) == duplicateKey);
        if (duplicate) {
          return current;
        }
        const sourceNodeType = nodes.find((node) => node.id === (newConnection.source || oldEdge.source))?.data.type || oldEdge.data?.sourceNodeType || 'hangup';
        const reconnected = reconnectEdge(oldEdge, newConnection, current).map((edge) =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                data: {
                  branchKey: oldEdge.data?.branchKey || oldCondition || 'default',
                  condition: oldCondition,
                  sourceNodeType: String(sourceNodeType),
                  onDelete: () => deleteEdge(edge.id),
                },
              }
            : edge,
        );
        return attachEdgeMetadata(reconnected, nodes, deleteEdge);
      });
    },
    [deleteEdge, nodes, setEdges],
  );

  const onReconnectStart = useCallback(() => {}, []);

  const handleNodeDragStop = useCallback<NodeDragHandler>((_event, draggedNode) => {
    if (draggedNode.data.type === 'group') {
      return;
    }

    setNodes((current) => {
      const mergedNodes = current.map((node) => (node.id === draggedNode.id ? { ...node, ...draggedNode } : node));
      const targetGroup = getContainingGroupNode({ ...draggedNode }, mergedNodes);

      if (!targetGroup) {
        return decorateEditorNodes(mergedNodes);
      }

      const nextNodes = mergedNodes.map((node) => (
        node.id === draggedNode.id ? reparentNodeIntoGroup(node, targetGroup, mergedNodes) : node
      ));
      return decorateEditorNodes(nextNodes);
    });
  }, [decorateEditorNodes]);

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const selectableNodes = selectedNodes.filter((node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX));
      const selectableEdges = selectedEdges.filter((edge) => !edge.data?.isSubflowJump);
      const firstNode = selectableNodes[0] as Node<FlowNodeData> | undefined;
      const firstEdge = selectableEdges[0] as Edge<BuilderEdgeData> | undefined;

      setSelectedNodeIds(selectableNodes.map((node) => node.id));

      if (firstNode) {
        setSelectedNodeId(firstNode.id);
        setSelectedEdgeId(null);
        return;
      }

      if (firstEdge) {
        setSelectedNodeId(null);
        setSelectedEdgeId(firstEdge.id);
        return;
      }

      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [],
  );

  const handleDragStart = (type: BuilderNodeType) => {
    window.sessionStorage.setItem('flow-builder-node-type', type);
  };

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = window.sessionStorage.getItem('flow-builder-node-type') as BuilderNodeType | null;
      if (!type || !rfInstance) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const position = rfInstance.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      let newNode = buildCanvasNode(type, nodes.length);
      newNode.position = position;
      const containingGroup = getContainingGroupNode(newNode, nodes);
      if (containingGroup) {
        newNode = reparentNodeIntoGroup(newNode, containingGroup, [...nodes, containingGroup]);
      }
      setNodes((current) => decorateEditorNodes([...current, newNode]));
      setSelectedNodeId(newNode.id);
      setSelectedNodeIds([newNode.id]);
      setSelectedEdgeId(null);
    },
    [rfInstance, deleteNode, nodes.length, setNodes],
  );

  const handleGroupSelection = () => {
    if (!canGroupSelection) {
      return;
    }

    const paddingX = 24;
    const paddingTop = 32;
    const paddingBottom = 24;
    const minX = Math.min(...groupableSelection.map((node) => node.position.x));
    const minY = Math.min(...groupableSelection.map((node) => node.position.y));
    const maxX = Math.max(...groupableSelection.map((node) => node.position.x + resolveNodeDimension(node.width ?? node.style?.width, 170)));
    const maxY = Math.max(...groupableSelection.map((node) => node.position.y + resolveNodeDimension(node.height ?? node.style?.height, 72)));
    const groupWidth = Math.max(200, maxX - minX + paddingX * 2);
    const groupHeight = Math.max(150, maxY - minY + paddingTop + paddingBottom);
    const groupId = `group-${Date.now()}`;
    const groupPosition = { x: minX - paddingX, y: minY - paddingTop };
    const groupNode: Node<FlowNodeData> = {
      id: groupId,
      type: 'group',
      position: groupPosition,
      data: {
        label: 'New Group',
        type: 'group',
        config: {
          width: groupWidth,
          height: groupHeight,
        },
      },
      style: {
        width: groupWidth,
        height: groupHeight,
      },
      draggable: true,
      selectable: true,
    };

    const selectedIds = new Set(groupableSelection.map((node) => node.id));
    const updatedNodes = nodes.map((node) => {
      if (!selectedIds.has(node.id)) {
        return node;
      }

      return {
        ...node,
        parentId: groupId,
        extent: 'parent' as const,
        position: {
          x: node.position.x - groupPosition.x,
          y: node.position.y - groupPosition.y,
        },
      };
    });

    setEditingGroupId(groupId);
    setNodes(decorateEditorNodes([groupNode, ...updatedNodes], groupId));
    setSelectedNodeId(groupId);
    setSelectedNodeIds([groupId]);
    setSelectedEdgeId(null);
  };

  const handleUngroupSelection = useCallback(() => {
    if (!selectedGroupNode) {
      return;
    }

    const groupId = selectedGroupNode.id;
    const nextNodes = nodes.flatMap((node) => {
      if (node.id === groupId) {
        return [];
      }

      if (node.parentId !== groupId) {
        return [node];
      }

      return [removeNodeFromGroup(node, nodes)];
    });

    setEditingGroupId(null);
    setNodes(decorateEditorNodes(nextNodes, null));
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
  }, [decorateEditorNodes, nodes, selectedGroupNode]);

  const handleRemoveFromGroup = useCallback(() => {
    if (!selectedChildNode) {
      return;
    }

    const nextNodes = nodes.map((node) => (node.id === selectedChildNode.id ? removeNodeFromGroup(node, nodes) : node));
    setNodes(decorateEditorNodes(nextNodes));
    setSelectedNodeId(selectedChildNode.id);
    setSelectedNodeIds([selectedChildNode.id]);
    setSelectedEdgeId(null);
  }, [decorateEditorNodes, nodes, selectedChildNode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      if (event.key !== 'Backspace' && event.key !== 'Delete') {
        return;
      }

      if (selectedEdgeId) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
        return;
      }

      if (selectedNodeIds.length === 1 && selectedGroupNode) {
        event.preventDefault();
        handleUngroupSelection();
        return;
      }

      if (selectedNodeIds.length === 0) {
        return;
      }

      event.preventDefault();
      for (const nodeId of selectedNodeIds) {
        deleteNode(nodeId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [deleteEdge, deleteNode, handleUngroupSelection, selectedEdgeId, selectedGroupNode, selectedNodeIds]);

  const handleLabelChange = (value: string) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      decorateEditorNodes(
        current.map((node) => (
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, label: value } }
            : node
        )),
      ),
    );
  };

  const handleConfigValueChange = (field: string, value: unknown) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      decorateEditorNodes(
        current.map((node) => {
          if (node.id !== selectedNodeId) return node;
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                [field]: value,
              },
            },
          };
        }),
      ),
    );
  };

  const handleConfigChange = (field: string, value: string) => {
    const numericFields = new Set(['timeout_ms', 'attempt_timeout_ms', 'total_timeout_ms', 'max_timeout_attempts', 'max_invalid_attempts']);
    handleConfigValueChange(field, numericFields.has(field) ? Number(value) || 0 : value);
  };

  const handleMenuBranchToggle = (branch: string, checked: boolean) => {
    const currentBranches = sanitizeMenuBranches(selectedConfig.branches);
    const nextBranches = checked
      ? Array.from(new Set([...currentBranches, branch]))
      : currentBranches.filter((value) => value !== branch);
    handleConfigValueChange('branches', nextBranches);
    if (!checked) {
      const currentTargets = sanitizeMenuSubmenuTargets(selectedConfig.submenu_branch_targets);
      if (currentTargets[branch]) {
        delete currentTargets[branch];
        handleConfigValueChange('submenu_branch_targets', currentTargets);
      }
    }
  };

  const handleMenuSubflowTargetChange = (branch: string, targetNodeKey: string | null) => {
    const currentTargets = sanitizeMenuSubmenuTargets(selectedConfig.submenu_branch_targets);
    if (targetNodeKey) {
      currentTargets[branch] = targetNodeKey;
    } else {
      delete currentTargets[branch];
    }
    handleConfigValueChange('submenu_branch_targets', currentTargets);
  };

  const handleConfigReplace = (nextConfig: Record<string, unknown>) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      decorateEditorNodes(
        current.map((node) => (
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, config: nextConfig } }
            : node
        )),
      ),
    );
  };

  const handleEdgeConditionChange = (value: string | null) => {
    if (!selectedEdgeId) return;
    setEdges((current) =>
      attachEdgeMetadata(
        current.map((edge) =>
          edge.id === selectedEdgeId
            ? {
                ...edge,
                data: {
                  branchKey: value || 'default',
                  condition: value,
                  sourceNodeType: String(edge.data?.sourceNodeType || nodes.find((node) => node.id === edge.source)?.data.type || 'hangup'),
                  onDelete: () => deleteEdge(edge.id),
                },
              }
            : edge,
        ),
        nodes,
        deleteEdge,
      ),
    );
  };

  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const audioFileSelected = Number(selectedConfig.audio_file_id || 0) > 0;
  const promptAudioSelected = Number(selectedConfig.prompt_audio_file_id || 0) > 0;
  const selectedMenuBranches = sanitizeMenuBranches(selectedConfig.branches);
  const selectedMenuSubmenuTargets = sanitizeMenuSubmenuTargets(selectedConfig.submenu_branch_targets);
  const selectedMenuLocalEdgeBranches = useMemo(
    () => new Set(
      edges
        .filter((edge) => edge.source === selectedNodeId)
        .map((edge) => resolveMenuBranchValue(edge.data?.branchKey, edge.data?.condition))
        .filter((value): value is string => Boolean(value)),
    ),
    [edges, selectedNodeId],
  );
  const audioOptions = audioItems.map((item) => ({ value: String(item.id), label: item.name }));
  const nodeOptions = nodes.map((node) => ({ value: node.id, label: `${node.id} — ${node.data.label}` }));
  const conditionOptions = conditionValues.map((value) => ({ value, label: value }));
  const edgeConditionOptions = useMemo(() => {
    if (!selectedEdge || !selectedEdgeSourceNode) {
      return [] as Array<{ value: string; label: string }>;
    }

    if (selectedEdgeSourceNode.data.type === 'menu') {
      const menuBranches = sanitizeMenuBranches(selectedEdgeSourceNode.data.config.branches);
      return [...menuBranches, 'complete'].map((value) => ({ value, label: value }));
    }

    if (selectedEdgeSourceNode.data.type === 'get_digits') {
      return conditionOptions;
    }

    return [] as Array<{ value: string; label: string }>;
  }, [conditionOptions, selectedEdge, selectedEdgeSourceNode]);

  const saveFlow = async (
    versionMessage?: string,
    options?: { auto?: boolean },
  ): Promise<FlowDetail | null> => {
    if (!flow) return null;
    if (saveInFlightRef.current) {
      return null;
    }
    const validationError = await validateFlowBeforeSave(nodes, edges);
    if (validationError) {
      if (!options?.auto) {
        setSaveState('failed');
        showEditorNotice(validationError);
      }
      return null;
    }
    saveInFlightRef.current = true;
    setSaveState('saving');
    try {
      const payload = createSavePayload(flow, nodes, edges, versionMessage);
      const response = isDraft ? await createFlow(payload) : await updateFlow(String(currentFlowId), payload);
      setFlow(response.data);
      if (isDraft) {
        setRootFlowId(response.data.id);
      }
      setCurrentFlowId(response.data.id);
      setIsDraft(false);
      const panelWidth = canvasPanelRef.current?.clientWidth || 900;
      const mappedNodes = mapFlowToNodes(response.data);
      const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
      const nextNodes = decorateEditorNodes(arrangedNodes, null);
      const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, deleteEdge);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
      window.setTimeout(() => {
        void rfInstance?.fitView({ padding: 0.2, duration: 300 });
      }, 150);
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
      setEditingGroupId(null);
      showEditorNotice(null);
      if (response.data.id > 0) {
        const [refreshedVersions, breadcrumbResponse] = await Promise.all([
          listFlowVersions(response.data.id),
          getFlowBreadcrumb(response.data.id),
        ]);
        setVersions(refreshedVersions.data);
        setBreadcrumb(breadcrumbResponse.data);
        setTreeRefreshKey((current) => current + 1);
      }
      setSaveState('saved');
      if (isDraft) {
        navigate(`/flows/${response.data.id}`, { replace: true });
      }
      return response.data;
    } catch (error) {
      if (!options?.auto) {
        setSaveState('failed');
        showEditorNotice(getApiError(error, 'failed to save flow'));
      }
      return null;
    } finally {
      saveInFlightRef.current = false;
      if (saveFeedbackTimer.current) {
        window.clearTimeout(saveFeedbackTimer.current);
      }
      saveFeedbackTimer.current = window.setTimeout(() => {
        setSaveState('idle');
      }, 2000);
    }
  };

  useEffect(() => {
    if (!hasUnsavedChanges || !isInitialized || !flow) {
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
      }
      return;
    }

    if (versionSaveState === 'saving' || saveState === 'saving' || confirmLeaveOpen || compareVersion) {
      return;
    }

    if (autoSaveTimer.current) {
      window.clearTimeout(autoSaveTimer.current);
    }

    autoSaveTimer.current = window.setTimeout(() => {
      void saveFlow(undefined, { auto: true });
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (autoSaveTimer.current) {
        window.clearTimeout(autoSaveTimer.current);
      }
    };
  }, [compareVersion, confirmLeaveOpen, flow, hasUnsavedChanges, isInitialized, saveState, versionSaveState, saveFlow]);

  const setFlowName = (value: string) => {
    if (!flow) return;
    setFlow({ ...flow, name: value });
  };

  const handleTidyLayout = () => {
    const nextNodes = decorateEditorNodes(layoutFlow(nodes, edges));
    setNodes(nextNodes);
    window.setTimeout(() => {
      void rfInstance?.fitView({ padding: 0.2, duration: 400 });
    }, 50);
  };

  const handlePaneClick = useCallback((event: { target: EventTarget | null }) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.react-flow__edge') || target?.closest('.react-flow__node')) {
      return;
    }
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
  }, []);

  const handleVersionsToggle = () => {
    setVersionsOpen((current) => !current);
  };

  const handleCreateVersion = async () => {
    if (!flow) {
      return;
    }

    const trimmed = versionMessage.trim();
    if (!trimmed) {
      return;
    }

    setVersionSaveState('saving');
    setVersionNotice(null);

    let activeFlow = flow;
    if (hasUnsavedChanges) {
      const saved = await saveFlow(trimmed);
      if (!saved) {
        setVersionSaveState('idle');
        return;
      }
      activeFlow = saved;
      setVersionMessage('');
      setVersionNotice('Flow saved and version committed.');
      setVersionSaveState('idle');
      return;
    }

    const response = await createFlowVersion(activeFlow.id, trimmed);
    setVersionMessage('');
    setVersionNotice(hasUnsavedChanges ? 'Flow saved and version committed.' : 'Version committed.');
    const refreshed = await listFlowVersions(activeFlow.id);
    setVersions(refreshed.data);
    setVersionSaveState('idle');
    if ('snapshot' in response.data) {
      setCompareVersion(response.data);
    }
  };

  const handleRequestRestore = (version: FlowVersionSummary) => {
    setPendingRestoreVersion(version);
    setRestoreConfirmOpen(true);
  };

  const handleCancelRestore = () => {
    setPendingRestoreVersion(null);
    setRestoreConfirmOpen(false);
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestoreVersion || !flow) {
      return;
    }

    await restoreFlowVersion(flow.id, pendingRestoreVersion.id);
    const [response, breadcrumbResponse] = await Promise.all([
      getFlow(String(flow.id)),
      getFlowBreadcrumb(flow.id),
    ]);
    setFlow(response.data);
    setBreadcrumb(breadcrumbResponse.data);
    setTreeRefreshKey((current) => current + 1);
    setIsDraft(false);
    const panelWidth = canvasPanelRef.current?.clientWidth || 900;
    const mappedNodes = mapFlowToNodes(response.data);
    const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
    const nextNodes = decorateEditorNodes(arrangedNodes, null);
    const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, deleteEdge);
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingGroupId(null);
    setPendingRestoreVersion(null);
    setRestoreConfirmOpen(false);
  };

  const handleCompareVersion = async (version: FlowVersionSummary) => {
    if (!flow) {
      return;
    }

    const response = await getFlowVersion(flow.id, version.id);
    setCompareVersion(response.data);
  };

  const ensureSavedBeforeNavigation = async (): Promise<boolean> => {
    if (!hasUnsavedChanges) {
      return true;
    }
    const saved = await saveFlow();
    return Boolean(saved);
  };

  const handleBreadcrumbNavigate = async (flowId: number) => {
    const canNavigate = await ensureSavedBeforeNavigation();
    if (!canNavigate) {
      return;
    }
    setBreadcrumb((current) => {
      const index = current.findIndex((item) => item.flowId === flowId);
      return index >= 0 ? current.slice(0, index + 1) : current;
    });
    setCurrentFlowId(flowId);
    showEditorNotice(null);
  };

  const saveLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'failed' : 'save';
  const saveStatusLabel = saveState === 'saving'
    ? 'saving…'
    : saveState === 'saved'
      ? 'saved ✓'
      : saveState === 'failed'
        ? 'save failed'
        : hasUnsavedChanges
          ? 'unsaved changes'
          : 'up to date';
  const isSubflow = breadcrumb.length > 1;
  useEffect(() => {
    if (isSubflow && versionsOpen) {
      setVersionsOpen(false);
    }
  }, [isSubflow, versionsOpen]);

  const saveButtonClass = saveState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const leaveFlowEditor = async () => {
    const canLeave = await ensureSavedBeforeNavigation();
    if (canLeave) {
      navigate('/flows');
      return;
    }
    requestLeave({ kind: 'navigate', to: '/flows' });
  };

  const compareSnapshotNodes = compareVersion ? mapSnapshotToNodes(compareVersion.snapshot) : [];
  const compareSnapshotEdges = compareVersion ? mapSnapshotToEdges(compareVersion.snapshot) : [];
  const currentNodeIds = new Set(nodes.map((node) => node.id));
  const snapshotNodeIds = new Set(compareSnapshotNodes.map((node) => node.id));
  const addedNodeIds = new Set(nodes.filter((node) => !snapshotNodeIds.has(node.id)).map((node) => node.id));
  const removedNodeIds = new Set(compareSnapshotNodes.filter((node) => !currentNodeIds.has(node.id)).map((node) => node.id));
  const currentEdgeKeys = new Set(edges.map((edge) => makeVersionEdgeKey(edge)));
  const snapshotEdgeKeys = new Set(compareSnapshotEdges.map((edge) => makeVersionEdgeKey(edge)));
  const changedEdgeKeys = new Set([
    ...Array.from(currentEdgeKeys).filter((key) => !snapshotEdgeKeys.has(key)),
    ...Array.from(snapshotEdgeKeys).filter((key) => !currentEdgeKeys.has(key)),
  ]);
  const currentDiffNodes = decorateDiffNodes(nodes.map((node) => ({ ...node, selected: false })), addedNodeIds, '--accent');
  const versionDiffNodes = decorateDiffNodes(compareSnapshotNodes.map((node) => ({ ...node, selected: false })), removedNodeIds, '--color-error');
  const currentDiffEdges = decorateDiffEdges(edges.map((edge) => ({ ...edge, selected: false })), changedEdgeKeys);
  const versionDiffEdges = decorateDiffEdges(compareSnapshotEdges.map((edge) => ({ ...edge, selected: false })), changedEdgeKeys);
  const addedNodeLabels = nodes.filter((node) => addedNodeIds.has(node.id)).map((node) => node.data.type);
  const removedNodeLabels = compareSnapshotNodes.filter((node) => removedNodeIds.has(node.id)).map((node) => node.data.type);
  const changedEdgeLabels = Array.from(changedEdgeKeys).map((key) => {
    const [source, target] = key.split('|');
    return `${source}→${target}`;
  });

  return (
    <div className={styles.page}>
      {editorNotice ? <div className={styles.editorNotice}>{editorNotice}</div> : null}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button
            className={styles.secondaryButton}
            onClick={
              isSubflow
                ? () => void handleBreadcrumbNavigate(breadcrumb[breadcrumb.length - 2].flowId)
                : () => void leaveFlowEditor()
            }
            type="button"
          >
            {isSubflow ? '← back to parent' : 'back'}
          </button>
          <button className={styles.secondaryButton} onClick={handleTidyLayout} type="button">tidy layout</button>
          {canGroupSelection ? (
            <button className={styles.secondaryButton} onClick={handleGroupSelection} type="button">group</button>
          ) : null}
          {canUngroupSelection ? (
            <button className={styles.secondaryButton} onClick={handleUngroupSelection} type="button">ungroup</button>
          ) : null}
          {canRemoveFromGroupSelection ? (
            <button className={styles.secondaryButton} onClick={() => void handleRemoveFromGroup()} type="button">remove from group</button>
          ) : null}
          <input className={styles.flowNameInput} value={flow?.name || 'loading…'} onChange={(event) => { setFlowName(event.target.value); showError(null); }} />
        </div>
        <div className={styles.topBarRight}>
          {!isSubflow ? (
            <button className={styles.secondaryButton} onClick={handleVersionsToggle} type="button">versions</button>
          ) : null}
          {!isSubflow ? (
            <button className={saveButtonClass} onClick={() => void saveFlow()} type="button">{saveLabel}</button>
          ) : (
            <span className={styles.saveStatus}>{saveStatusLabel}</span>
          )}
        </div>
      </div>

      <div className={styles.editorShell}>
        <section className={styles.leftPanel}>
          <div className={styles.panelTitle}>node palette</div>
          <div className={styles.paletteList}>
            {palette.map((item) => (
              <div
                className={styles.paletteItem}
                draggable={item.type !== 'start'}
                key={item.type}
                onDragStart={() => handleDragStart(item.type)}
                title={item.type === 'start' ? 'Seed flows already contain the required start node' : 'Drag onto canvas'}
              >
                <span className={`${styles.paletteBar} ${styles[`bar${item.type.replace('_', '')}`]}`} />
                {renderPaletteIcon(item.type)}
                <div>
                  <div className={styles.paletteType}>{item.type}</div>
                  <div className={styles.paletteLabel}>{item.label}</div>
                </div>
              </div>
            ))}
          </div>
          <FlowTreePanel tree={flowTree} currentFlowId={currentFlowId} onNavigate={handleBreadcrumbNavigate} />
        </section>

        <section ref={canvasPanelRef} className={styles.canvasPanel} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <FlowBreadcrumb items={breadcrumb} onNavigate={handleBreadcrumbNavigate} />
          <div className={styles.canvasWrapper}>
            <ReactFlow
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodes={canvasNodes}
            edges={canvasEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onReconnectStart={onReconnectStart}
            onNodeDoubleClick={(_event, node) => {
              if (String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)) {
                return;
              }
              if (node.data.type === 'menu') {
                void handleOpenSubmenu(node.id);
              }
            }}
            onNodeDragStop={handleNodeDragStop}
            onEdgeClick={onEdgeClick}
            onSelectionChange={handleSelectionChange}
            multiSelectionKeyCode="Shift"
            onPaneClick={handlePaneClick}
            onNodesDelete={(deletedNodes) => {
              const deletedIds = new Set(
                deletedNodes
                  .filter((node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX))
                  .map((node) => node.id),
              );
              if (deletedIds.size === 0) {
                return;
              }
              setEdges((current) => attachEdgeMetadata(current.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)), nodes, deleteEdge));
              setNodes((current) => {
                const groupIds = new Set(
                  deletedNodes
                    .filter((node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX))
                    .filter((node) => node.data.type === 'group')
                    .map((node) => node.id),
                );
                if (groupIds.size === 0) {
                  return current;
                }

                return decorateEditorNodes(current.flatMap((node) => {
                  if (groupIds.has(node.id)) {
                    return [];
                  }
                  if (node.parentId && groupIds.has(node.parentId)) {
                    return [removeNodeFromGroup(node, current)];
                  }
                  return [node];
                }));
              });
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              setRfInstance(instance);
              if (nodes.length > 0 && !fitDone.current) {
                fitDone.current = true;
                window.setTimeout(() => {
                  void instance.fitView({ padding: 0.2, duration: 300 });
                }, 100);
              }
            }}
            deleteKeyCode={null}
          >
            <Background color="var(--border-subtle)" gap={24} />
            <Controls position="bottom-left" />
            <MiniMap
              nodeColor={minimapNodeColor}
              maskColor="var(--overlay-strong)"
              position="bottom-right"
              {...miniMapSizeProps}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: '6px',
                width: 160,
                height: 120,
              }}
              pannable
              zoomable
            />
          </ReactFlow>
          </div>
        </section>

        <section className={styles.rightPanel}>
          <div className={styles.panelTitle}>{selectedEdge ? 'edge config' : 'node config'}</div>
          {selectedEdge ? (
            <div className={styles.form}>
              {selectedEdgeSourceNode && (selectedEdgeSourceNode.data.type === 'get_digits' || selectedEdgeSourceNode.data.type === 'menu') ? (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>condition</span>
                  <SearchableSelect
                    options={edgeConditionOptions}
                    value={selectedEdge.data?.condition || selectedEdge.data?.branchKey || null}
                    onChange={handleEdgeConditionChange}
                    placeholder="select condition"
                  />
                </label>
              ) : null}
              <div className={styles.meta}>source: {selectedEdge.source}</div>
              <div className={styles.meta}>target: {selectedEdge.target}</div>
            </div>
          ) : selectedNode ? (
            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>label</span>
                <input className={styles.input} value={selectedNode.data.label} onChange={(event) => handleLabelChange(event.target.value)} />
              </label>

              {selectedNode.data.type === 'play_audio' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>audio file</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.audio_file_id ? String(selectedConfig.audio_file_id) : null}
                      onChange={(value) => handleConfigChange('audio_file_id', value || '')}
                      placeholder="built-in path / manual"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>audio_file_path</span>
                    <input
                      className={styles.input}
                      disabled={audioFileSelected}
                      placeholder={audioFileSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                      value={audioFileSelected ? 'disabled — using audio file above' : String(selectedConfig.audio_file_path || '')}
                      onChange={(event) => handleConfigChange('audio_file_path', event.target.value)}
                    />
                  </label>
                </>
              ) : null}

              {selectedNode.data.type === 'get_digits' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>prompt audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.prompt_audio_file_id ? String(selectedConfig.prompt_audio_file_id) : null}
                      onChange={(value) => handleConfigChange('prompt_audio_file_id', value || '')}
                      placeholder="built-in path / manual"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>prompt_path</span>
                    <input
                      className={styles.input}
                      disabled={promptAudioSelected}
                      placeholder={promptAudioSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                      value={promptAudioSelected ? 'disabled — using audio file above' : String(selectedConfig.prompt_path || '')}
                      onChange={(event) => handleConfigChange('prompt_path', event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>timeout_ms</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.timeout_ms || 5000)} onChange={(event) => handleConfigChange('timeout_ms', event.target.value)} />
                  </label>
                </>
              ) : null}

              {selectedNode.data.type === 'menu' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>prompt audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.prompt_audio_file_id ? String(selectedConfig.prompt_audio_file_id) : null}
                      onChange={(value) => handleConfigChange('prompt_audio_file_id', value || '')}
                      placeholder="built-in path / manual"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>prompt_path</span>
                    <input
                      className={styles.input}
                      disabled={promptAudioSelected}
                      placeholder={promptAudioSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                      value={promptAudioSelected ? 'disabled — using audio file above' : String(selectedConfig.prompt_path || '')}
                      onChange={(event) => handleConfigChange('prompt_path', event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>timeout prompt audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.timeout_prompt_audio_id ? String(selectedConfig.timeout_prompt_audio_id) : null}
                      onChange={(value) => handleConfigChange('timeout_prompt_audio_id', value || '')}
                      placeholder="select timeout prompt"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>invalid prompt audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.invalid_prompt_audio_id ? String(selectedConfig.invalid_prompt_audio_id) : null}
                      onChange={(value) => handleConfigChange('invalid_prompt_audio_id', value || '')}
                      placeholder="select invalid prompt"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>final failure audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.final_failure_audio_id ? String(selectedConfig.final_failure_audio_id) : null}
                      onChange={(value) => handleConfigChange('final_failure_audio_id', value || '')}
                      placeholder="select goodbye prompt"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>timeout_ms</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.timeout_ms || 5000)} onChange={(event) => handleConfigChange('timeout_ms', event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>max timeout attempts</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.max_timeout_attempts || 3)} onChange={(event) => handleConfigChange('max_timeout_attempts', event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>max invalid attempts</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.max_invalid_attempts || 3)} onChange={(event) => handleConfigChange('max_invalid_attempts', event.target.value)} />
                  </label>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>branches</span>
                    <div className={styles.menuBranchList}>
                      {menuBranchOptions.map((branch) => {
                        const checked = selectedMenuBranches.includes(branch);
                        return (
                          <div className={styles.menuBranchGroup} key={branch}>
                            <label className={styles.menuBranchOption}>
                              <input
                                checked={checked}
                                onChange={(event) => handleMenuBranchToggle(branch, event.target.checked)}
                                type="checkbox"
                              />
                              <span className={styles.menuBranchLabel}>{branch}</span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>submenu branch targets</span>
                    {selectedNode.data.subflowId ? (
                      <div className={styles.menuBranchList}>
                        {selectedMenuBranches.map((branch) => (
                          <div className={styles.menuBranchGroup} key={`submenu-target-${branch}`}>
                            <span className={styles.menuBranchLabel}>{branch}</span>
                            <div className={styles.meta}>
                              {selectedMenuLocalEdgeBranches.has(branch)
                                ? 'disabled — routed by local edge'
                                : submenuNodeOptionsLoading
                                  ? 'loading submenu start...'
                                  : `auto: ${selectedMenuSubmenuTargets[branch] || submenuStartNodeKey || 'start'}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.meta}>Save flow once to create submenu, then map branches here.</div>
                    )}
                  </div>
                  <div className={styles.meta}>subflow: {selectedNode.data.subflowId ? `#${selectedNode.data.subflowId}` : 'created on save'}</div>
                </>
              ) : null}

              {selectedNode.data.type === 'hunt' ? (
                <HuntConfigPanel
                  nodeId={selectedNode.id}
                  config={selectedConfig}
                  audioOptions={audioOptions}
                  nodeOptions={nodeOptions}
                  onConfigReplace={handleConfigReplace}
                />
              ) : null}

              {selectedNode.data.type === 'transfer' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>destination</span>
                    <input className={styles.input} placeholder="SIP/trunk/+94XXXXXXXXX" value={String(selectedConfig.destination || '')} onChange={(event) => handleConfigChange('destination', event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>timeout_ms</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.timeout_ms || 30000)} onChange={(event) => handleConfigChange('timeout_ms', event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>on_no_answer</span>
                    <SearchableSelect
                      options={nodeOptions.filter((option) => option.value !== selectedNode.id)}
                      value={selectedConfig.on_no_answer ? String(selectedConfig.on_no_answer) : null}
                      onChange={(value) => handleConfigChange('on_no_answer', value || '')}
                      placeholder="select fallback node"
                    />
                  </label>
                </>
              ) : null}

              <div className={styles.meta}>node key: {selectedNode.id}</div>
              <div className={styles.meta}>type: {selectedNode.data.type}</div>
            </div>
          ) : (
            <div className={styles.empty}>Select a node or edge to edit its config.</div>
          )}
        </section>
      </div>

      <aside className={`${styles.versionsPanel} ${versionsOpen ? styles.versionsPanelOpen : ''}`}>
        <div className={styles.versionsHeader}>
          <div className={styles.versionsTitle}>versions</div>
          <button className={styles.secondaryButton} onClick={handleVersionsToggle} type="button">×</button>
        </div>
        <div className={styles.versionsCommitRow}>
          <input
            className={styles.input}
            placeholder="Describe this version..."
            value={versionMessage}
            onChange={(event) => { setVersionMessage(event.target.value); showError(null); }}
          />
          <button
            className={styles.primaryButton}
            disabled={!versionMessage.trim() || versionSaveState === 'saving'}
            onClick={() => void handleCreateVersion()}
            type="button"
          >
            {versionSaveState === 'saving' ? 'saving…' : 'save'}
          </button>
        </div>
        {versionNotice ? <div className={styles.versionNotice}>{versionNotice}</div> : null}
        <div className={styles.versionsList}>
          {versionsLoading ? <div className={styles.empty}>loading versions…</div> : null}
          {!versionsLoading && versions.length === 0 ? <div className={styles.empty}>No committed versions yet.</div> : null}
          {!versionsLoading ? versions.map((version) => (
            <div className={styles.versionItem} key={version.id}>
              <div className={styles.versionMetaRow}>
                <div className={styles.versionNum}>v{version.versionNum}</div>
                <div className={styles.meta}>{formatDateTime(version.createdAt)}</div>
                <div className={styles.meta}>{version.nodeCount} nodes</div>
              </div>
              <div className={styles.versionMessage}>{version.message}</div>
              <div className={styles.versionActions}>
                <button className={styles.secondaryButton} onClick={() => handleRequestRestore(version)} type="button">restore</button>
                <button className={styles.secondaryButton} onClick={() => void handleCompareVersion(version)} type="button">compare</button>
              </div>
            </div>
          )) : null}
        </div>
      </aside>

      {compareVersion ? (
        <div className={styles.compareOverlay}>
          <div className={styles.compareHeader}>
            <button className={styles.secondaryButton} onClick={() => setCompareVersion(null)} type="button">← back</button>
            <div className={styles.compareTitle}>Comparing v{flow?.versionNumber || 'current'} (current) vs v{compareVersion.versionNum}</div>
          </div>
          <div className={styles.compareSubhead}>v{compareVersion.versionNum} — "{compareVersion.message}"</div>
          <div className={styles.compareGrid}>
            <div className={styles.compareColumn}>
              <div className={styles.compareCanvasTitle}>Current</div>
              <div className={styles.compareCanvas}>
                <ReactFlow nodes={currentDiffNodes} edges={currentDiffEdges} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll>
                  <Background color="var(--border-subtle)" gap={24} />
                </ReactFlow>
              </div>
            </div>
            <div className={styles.compareColumn}>
              <div className={styles.compareCanvasTitle}>v{compareVersion.versionNum} — "{compareVersion.message}"</div>
              <div className={styles.compareCanvas}>
                <ReactFlow nodes={versionDiffNodes} edges={versionDiffEdges} fitView fitViewOptions={{ padding: 0.2 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll>
                  <Background color="var(--border-subtle)" gap={24} />
                </ReactFlow>
              </div>
            </div>
          </div>
          <div className={styles.compareLists}>
            <div className={styles.compareListRow}><span className={styles.addedText}>Nodes added ({addedNodeLabels.length}):</span> {addedNodeLabels.length ? addedNodeLabels.join(', ') : '—'}</div>
            <div className={styles.compareListRow}><span className={styles.removedText}>Nodes removed ({removedNodeLabels.length}):</span> {removedNodeLabels.length ? removedNodeLabels.join(', ') : '—'}</div>
            <div className={styles.compareListRow}><span className={styles.changedText}>Edges changed ({changedEdgeLabels.length}):</span> {changedEdgeLabels.length ? changedEdgeLabels.join(', ') : '—'}</div>
          </div>
          <div className={styles.compareSummaryBar}>
            <div className={styles.addedText}>Nodes added: {addedNodeLabels.length}</div>
            <div className={styles.removedText}>Nodes removed: {removedNodeLabels.length}</div>
            <div className={styles.changedText}>Edges changed: {changedEdgeLabels.length}</div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmLeaveOpen}
        title="Unsaved changes"
        message="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        onConfirm={handleConfirmLeave}
        onCancel={handleCancelLeave}
      />
      <ConfirmDialog
        open={restoreConfirmOpen}
        title="Restore version"
        message="Restore this version? Current unsaved changes will be lost."
        confirmLabel="Restore"
        onConfirm={() => void handleConfirmRestore()}
        onCancel={handleCancelRestore}
      />
    </div>
  );
}
