import { useCallback, useMemo, useState } from 'react';
import {
  addEdge,
  Connection,
  Edge,
  Node,
  NodeDragHandler,
  OnSelectionChangeParams,
  reconnectEdge,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import type { BuilderNodeType, FlowNodeData } from '../types';
import { layoutFlow } from '../utils/layoutFlow';

// ─── Local type aliases (mirrored from FlowEditorPage to avoid exposing internals) ───

type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
  isSubflowJump?: boolean;
  subflowJumpLabel?: string;
  onDelete?: (edgeId: string) => void;
};

// ─── Module-level pure helpers re-exported so the page and tests can use them ──

const SUBFLOW_JUMP_NODE_ID_PREFIX = '__submenu_jump_anchor__';

const menuBranchOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
const menuRoutableBranchSet = new Set(menuBranchOptions);

export { SUBFLOW_JUMP_NODE_ID_PREFIX, menuBranchOptions, menuRoutableBranchSet };

function sanitizeMenuBranches(value: unknown): string[] {
  if (!Array.isArray(value)) return ['1', '2'];
  const branches = value
    .map((item) => String(item || '').trim())
    .filter((item) => menuRoutableBranchSet.has(item));
  return branches.length > 0 ? Array.from(new Set(branches)) : ['1', '2'];
}

function resolveNodeDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return numeric;
}

function isGroupNode(node: Node<FlowNodeData>): boolean {
  return node.data.type === 'group';
}

function getAbsoluteNodePosition(
  node: Node<FlowNodeData>,
  nodeMap: Map<string, Node<FlowNodeData>>,
): { x: number; y: number } {
  if (!node.parentId) return node.position;
  const parent = nodeMap.get(node.parentId);
  if (!parent) return node.position;
  const parentPosition = getAbsoluteNodePosition(parent, nodeMap);
  return { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y };
}

function getNodeSize(node: Node<FlowNodeData>): { width: number; height: number } {
  return {
    width: resolveNodeDimension(node.width ?? node.style?.width ?? node.data.config.width, 170),
    height: resolveNodeDimension(node.height ?? node.style?.height ?? node.data.config.height, 72),
  };
}

export function getContainingGroupNode(
  node: Node<FlowNodeData>,
  allNodes: Array<Node<FlowNodeData>>,
): Node<FlowNodeData> | null {
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
      return (
        centerX >= groupPosition.x &&
        centerX <= groupPosition.x + groupWidth &&
        centerY >= groupPosition.y &&
        centerY <= groupPosition.y + groupHeight
      );
    });

  return groups.length > 0 ? groups[groups.length - 1] : null;
}

export function reparentNodeIntoGroup(
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

export function removeNodeFromGroup(
  childNode: Node<FlowNodeData>,
  allNodes: Array<Node<FlowNodeData>>,
): Node<FlowNodeData> {
  const nodeMap = new Map(allNodes.map((item) => [item.id, item]));
  const absolutePosition = getAbsoluteNodePosition(childNode, nodeMap);
  return { ...childNode, parentId: undefined, extent: undefined, position: absolutePosition };
}

export function attachEdgeMetadata(
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

export function decorateNodes(
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
      onLabelChange:
        node.data.type === 'group' || node.data.type === 'menu'
          ? (value: string) => options.onGroupLabelChange(node.id, value)
          : undefined,
      onLabelSubmit:
        node.data.type === 'group' || node.data.type === 'menu'
          ? () => options.onGroupLabelSubmit(node.id)
          : undefined,
      onLabelDoubleClick:
        node.data.type === 'group' ? () => options.onGroupLabelDoubleClick(node.id) : undefined,
      onOpenSubmenu: node.data.type === 'menu' ? () => options.onOpenSubmenu(node.id) : undefined,
      isEditing: node.id === options.editingGroupId,
    },
  }));
}

function makeEdgeKey(
  source: string | null,
  target: string | null,
  sourceHandle: string | null | undefined,
  condition: string | null,
): string {
  return `${source || ''}|${target || ''}|${sourceHandle || ''}|${condition || ''}`;
}

export function buildCanvasNode(type: BuilderNodeType, index: number): Node<FlowNodeData> {
  const palette: Array<{ type: BuilderNodeType; label: string }> = [
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
    { type: 'conference', label: 'Conference Room' },
    { type: 'callback', label: 'Callback' },
    { type: 'hangup', label: 'hangup' },
  ];
  function typeConfig(t: BuilderNodeType): Record<string, unknown> {
    if (t === 'start') return { queue_login_default_input_timeout_ms: 10000 };
    if (t === 'play_audio') return { audio_file_path: '', audio_file_id: '' };
    if (t === 'get_digits') return { timeout_ms: 5000, prompt_path: '', prompt_audio_file_id: '' };
    if (t === 'menu') return {
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
    if (t === 'business_hours') return {
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
    if (t === 'transfer') return { target_type: 'extension', target_value: '', timeout_ms: 30000, on_no_answer: '' };
    if (t === 'voicemail') return { mailbox_name: 'main', max_duration_seconds: 60, prompt_audio_file_id: null };
    if (t === 'hunt') return {
      destinations: [{ target_type: 'extension', target_value: '101' }],
      strategy: 'sequential',
      attempt_timeout_ms: 20000,
      total_timeout_ms: 60000,
      hold_audio_file_id: null,
      busy_audio_file_id: null,
      on_no_answer: '',
    };
    if (t === 'webhook') return {
      url: '',
      method: 'POST',
      include_caller: false,
      include_digits: false,
      timeout_ms: 5000,
      headers: [],
    };
    if (t === 'queue_login') return {
      queue_id: null,
      prompt_audio_file_id: null,
      wrong_pin_audio_file_id: null,
      login_success_audio_file_id: null,
      use_flow_default_timeout: true,
      input_timeout_ms: null,
    };
    if (t === 'queue') return { queue_id: null, prompt_audio_file_id: null };
    if (t === 'conference') return { roomName: '', waitForModerator: false, moderatorType: null, moderatorId: null };
    if (t === 'callback') return {
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


export interface UseFlowCanvasResult {
  nodes: Array<Node<FlowNodeData>>;
  edges: Array<Edge<BuilderEdgeData>>;
  setNodes: ReturnType<typeof useNodesState<FlowNodeData>>[1];
  setEdges: ReturnType<typeof useEdgesState<BuilderEdgeData>>[1];
  onNodesChange: ReturnType<typeof useNodesState<FlowNodeData>>[2];
  onEdgesChange: ReturnType<typeof useEdgesState<BuilderEdgeData>>[2];

  selectedNodeId: string | null;
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedNodeIds: string[];
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedEdgeId: string | null;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string | null>>;
  editingGroupId: string | null;
  setEditingGroupId: React.Dispatch<React.SetStateAction<string | null>>;

  selectedNode: Node<FlowNodeData> | null;
  selectedEdge: Edge<BuilderEdgeData> | null;
  selectedEdgeSourceNode: Node<FlowNodeData> | null;
  selectedGroupNode: Node<FlowNodeData> | null;
  canGroupSelection: boolean;
  canUngroupSelection: boolean;
  canRemoveFromGroupSelection: boolean;
  selectedChildNode: Node<FlowNodeData> | null;
  groupableSelection: Array<Node<FlowNodeData>>;

  decorateEditorNodes: (
    nextNodes: Array<Node<FlowNodeData>>,
    nextEditingGroupId?: string | null,
  ) => Array<Node<FlowNodeData>>;

  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  onConnect: (connection: Connection) => void;
  onEdgeClick: (event: React.MouseEvent, edge: Edge<BuilderEdgeData>) => void;
  onReconnect: (oldEdge: Edge<BuilderEdgeData>, newConnection: Connection) => void;
  onReconnectStart: () => void;
  handleNodeDragStop: NodeDragHandler;
  handleSelectionChange: (params: OnSelectionChangeParams) => void;
  handleDragStart: (type: BuilderNodeType) => void;
  handleDrop: (event: React.DragEvent<HTMLElement>, rfInstance: import('reactflow').ReactFlowInstance | null) => void;
  handleGroupSelection: () => void;
  handleUngroupSelection: () => void;
  handleRemoveFromGroup: () => void;
  handlePaneClick: (event: { target: EventTarget | null }) => void;
  triggerAutoLayout: (rfInstance: import('reactflow').ReactFlowInstance | null) => void;
  handleOpenSubmenuCallback: ((nodeId: string) => void) | null;
  setHandleOpenSubmenuCallback: (fn: ((nodeId: string) => void) | null) => void;
}

export function useFlowCanvas(): UseFlowCanvasResult {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdgeData>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  // Allows the page to inject the handleOpenSubmenu callback (which needs API state)
  const [handleOpenSubmenuCallback, setHandleOpenSubmenuCallback] = useState<((nodeId: string) => void) | null>(null);

  
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
    if (selectedCanvasNodes.length !== 1) return null;
    return isGroupNode(selectedCanvasNodes[0]) ? selectedCanvasNodes[0] : null;
  }, [selectedCanvasNodes]);

  const groupableSelection = useMemo(
    () => selectedCanvasNodes.filter((node) => !isGroupNode(node) && !node.parentId),
    [selectedCanvasNodes],
  );

  const canGroupSelection = groupableSelection.length >= 2 && groupableSelection.length === selectedCanvasNodes.length;
  const canUngroupSelection = Boolean(selectedGroupNode);
  const selectedChildNode =
    selectedCanvasNodes.length === 1 &&
    !isGroupNode(selectedCanvasNodes[0]) &&
    selectedCanvasNodes[0].parentId
      ? selectedCanvasNodes[0]
      : null;
  const canRemoveFromGroupSelection = Boolean(selectedChildNode);

  // ── Core mutation helpers ─────────────────────────────────────────────────────

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((current) => current.filter((edge) => edge.id !== edgeId));
      setSelectedEdgeId((current) => (current === edgeId ? null : current));
    },
    [setEdges],
  );

  // Passed through decorateEditorNodes — forward-declared to avoid circular dep.
  // eslint-disable-next-line prefer-const
  // eslint-disable-next-line prefer-const
  let deleteNodeRef: (nodeId: string) => void = () => {};

  const handleGroupLabelChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((current) =>
        decorateNodes(
          current.map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, label: value } } : node,
          ),
          {
            editingGroupId: nodeId,
            onDelete: (id: string) => deleteNodeRef(id),
            onGroupLabelChange: handleGroupLabelChange,
            onGroupLabelSubmit: handleGroupLabelSubmit,
            onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
            onOpenSubmenu: handleOpenSubmenuCallback || (() => {}),
          },
        ),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleOpenSubmenuCallback, setNodes],
  );

  const handleGroupLabelSubmit = useCallback(
    (nodeId: string) => {
      setEditingGroupId((current) => (current === nodeId ? null : current));
      setNodes((current) =>
        decorateNodes(current, {
          editingGroupId: null,
          onDelete: (id: string) => deleteNodeRef(id),
          onGroupLabelChange: handleGroupLabelChange,
          onGroupLabelSubmit: handleGroupLabelSubmit,
          onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
          onOpenSubmenu: handleOpenSubmenuCallback || (() => {}),
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleGroupLabelChange, handleOpenSubmenuCallback, setNodes],
  );

  const handleGroupLabelDoubleClick = useCallback(
    (nodeId: string) => {
      setEditingGroupId(nodeId);
      setNodes((current) =>
        decorateNodes(current, {
          editingGroupId: nodeId,
          onDelete: (id: string) => deleteNodeRef(id),
          onGroupLabelChange: handleGroupLabelChange,
          onGroupLabelSubmit: handleGroupLabelSubmit,
          onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
          onOpenSubmenu: handleOpenSubmenuCallback || (() => {}),
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleGroupLabelChange, handleGroupLabelSubmit, handleOpenSubmenuCallback, setNodes],
  );

  const decorateEditorNodes = useCallback(
    (nextNodes: Array<Node<FlowNodeData>>, nextEditingGroupId: string | null = editingGroupId) =>
      decorateNodes(nextNodes, {
        editingGroupId: nextEditingGroupId,
        onDelete: (id: string) => deleteNodeRef(id),
        onGroupLabelChange: handleGroupLabelChange,
        onGroupLabelSubmit: handleGroupLabelSubmit,
        onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
        onOpenSubmenu: handleOpenSubmenuCallback || (() => {}),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingGroupId, handleGroupLabelChange, handleGroupLabelDoubleClick, handleGroupLabelSubmit, handleOpenSubmenuCallback],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((current) => {
        const target = current.find((node) => node.id === nodeId);
        if (!target || target.data.type === 'start') return current;

        if (target.data.type === 'group') {
          const nextNodes = current.flatMap((node) => {
            if (node.id === nodeId) return [];
            if (node.parentId !== nodeId) return [node];
            return [removeNodeFromGroup(node, current)];
          });
          return decorateNodes(nextNodes, {
            editingGroupId: editingGroupId === nodeId ? null : editingGroupId,
            onDelete: (id: string) => deleteNodeRef(id),
            onGroupLabelChange: handleGroupLabelChange,
            onGroupLabelSubmit: handleGroupLabelSubmit,
            onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
            onOpenSubmenu: handleOpenSubmenuCallback || (() => {}),
          });
        }

        return decorateNodes(
          current.filter((node) => node.id !== nodeId),
          {
            editingGroupId,
            onDelete: (id: string) => deleteNodeRef(id),
            onGroupLabelChange: handleGroupLabelChange,
            onGroupLabelSubmit: handleGroupLabelSubmit,
            onGroupLabelDoubleClick: handleGroupLabelDoubleClick,
            onOpenSubmenu: handleOpenSubmenuCallback || (() => {}),
          },
        );
      });
      setEdges((current) =>
        attachEdgeMetadata(
          current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
          nodes,
          deleteEdge,
        ),
      );
      setSelectedNodeId((current) => (current === nodeId ? null : current));
      setSelectedNodeIds((current) => current.filter((value) => value !== nodeId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteEdge, editingGroupId, handleGroupLabelChange, handleGroupLabelDoubleClick, handleGroupLabelSubmit, handleOpenSubmenuCallback, nodes, setEdges, setNodes],
  );

  // Assign the forward ref so decorateEditorNodes can call deleteNode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (deleteNodeRef as any) = deleteNode;

  // ── Edge operations ───────────────────────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNodeType = nodes.find((node) => node.id === connection.source)?.data.type || 'hangup';
      const targetNodeType = nodes.find((node) => node.id === connection.target)?.data.type || 'hangup';
      const menuBranch = sourceNodeType === 'menu' ? String(connection.sourceHandle || 'complete') : null;
      const condition =
        sourceNodeType === 'get_digits'
          ? 'default'
          : sourceNodeType === 'menu'
          ? menuBranch
          : sourceNodeType === 'business_hours'
          ? String(connection.sourceHandle || 'closed')
          : null;
      const branchKey =
        sourceNodeType === 'hunt'
          ? 'no answer'
          : sourceNodeType === 'menu'
          ? menuBranch || 'complete'
          : sourceNodeType === 'business_hours'
          ? String(connection.sourceHandle || 'closed')
          : condition || 'default';
      const newKey = makeEdgeKey(connection.source, connection.target, connection.sourceHandle, condition);

      setEdges((current) => {
        if (sourceNodeType === 'webhook') {
          return current;
        }
        if (sourceNodeType === 'hunt') {
          const existingFromSource = current.filter((edge) => edge.source === connection.source);
          const hasExistingNonWebhookRoute = existingFromSource.some((edge) => {
            const edgeTargetType = nodes.find((node) => node.id === edge.target)?.data.type || 'hangup';
            return edgeTargetType !== 'webhook';
          });
          if (targetNodeType !== 'webhook' && hasExistingNonWebhookRoute) {
            return current;
          }
        }
        if (targetNodeType === 'webhook' && current.some((edge) => edge.source === connection.source && edge.target === connection.target)) {
          return current;
        }
        const duplicate = current.find(
          (edge) =>
            makeEdgeKey(edge.source, edge.target, edge.sourceHandle, edge.data?.condition ?? null) === newKey,
        );
        if (duplicate) return current;
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

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, clickedEdge: Edge<BuilderEdgeData>) => {
      if (clickedEdge.data?.isSubflowJump) return;
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setSelectedEdgeId(clickedEdge.id);
      setEdges((current) =>
        attachEdgeMetadata(
          current.map((edge) => ({ ...edge, selected: edge.id === clickedEdge.id })),
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
      const duplicateKey = makeEdgeKey(
        newConnection.source,
        newConnection.target,
        newConnection.sourceHandle,
        oldCondition,
      );
      setEdges((current) => {
        const duplicate = current.find(
          (edge) =>
            edge.id !== oldEdge.id &&
            makeEdgeKey(edge.source, edge.target, edge.sourceHandle, edge.data?.condition ?? null) === duplicateKey,
        );
        if (duplicate) return current;
        const sourceNodeType =
          nodes.find((node) => node.id === (newConnection.source || oldEdge.source))?.data.type ||
          oldEdge.data?.sourceNodeType ||
          'hangup';
        if (sourceNodeType === 'webhook') {
          return current;
        }
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

  // ── Node drag/drop ────────────────────────────────────────────────────────────

  const handleNodeDragStop = useCallback<NodeDragHandler>(
    (_event, draggedNode) => {
      if (draggedNode.data.type === 'group') return;
      setNodes((current) => {
        const mergedNodes = current.map((node) =>
          node.id === draggedNode.id ? { ...node, ...draggedNode } : node,
        );
        const targetGroup = getContainingGroupNode({ ...draggedNode }, mergedNodes);
        if (!targetGroup) return decorateEditorNodes(mergedNodes);
        const nextNodes = mergedNodes.map((node) =>
          node.id === draggedNode.id ? reparentNodeIntoGroup(node, targetGroup, mergedNodes) : node,
        );
        return decorateEditorNodes(nextNodes);
      });
    },
    [decorateEditorNodes],
  );

  const handleDragStart = useCallback((type: BuilderNodeType) => {
    window.sessionStorage.setItem('flow-builder-node-type', type);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, rfInstance: import('reactflow').ReactFlowInstance | null) => {
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
    [decorateEditorNodes, nodes, setNodes],
  );

  // ── Selection ─────────────────────────────────────────────────────────────────

  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      const selectableNodes = selectedNodes.filter(
        (node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX),
      );
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

  const handlePaneClick = useCallback((event: { target: EventTarget | null }) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.react-flow__edge') || target?.closest('.react-flow__node')) return;
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
  }, []);

  // ── Group operations ──────────────────────────────────────────────────────────

  const handleGroupSelection = useCallback(() => {
    if (!canGroupSelection) return;
    const paddingX = 24;
    const paddingTop = 32;
    const paddingBottom = 24;
    const minX = Math.min(...groupableSelection.map((node) => node.position.x));
    const minY = Math.min(...groupableSelection.map((node) => node.position.y));
    const maxX = Math.max(
      ...groupableSelection.map((node) => node.position.x + resolveNodeDimension(node.width ?? node.style?.width, 170)),
    );
    const maxY = Math.max(
      ...groupableSelection.map((node) => node.position.y + resolveNodeDimension(node.height ?? node.style?.height, 72)),
    );
    const groupWidth = Math.max(200, maxX - minX + paddingX * 2);
    const groupHeight = Math.max(150, maxY - minY + paddingTop + paddingBottom);
    const groupId = `group-${Date.now()}`;
    const groupPosition = { x: minX - paddingX, y: minY - paddingTop };
    const groupNode: Node<FlowNodeData> = {
      id: groupId,
      type: 'group',
      position: groupPosition,
      data: { label: 'New Group', type: 'group', config: { width: groupWidth, height: groupHeight } },
      style: { width: groupWidth, height: groupHeight },
      draggable: true,
      selectable: true,
    };
    const selectedIds = new Set(groupableSelection.map((node) => node.id));
    const updatedNodes = nodes.map((node) => {
      if (!selectedIds.has(node.id)) return node;
      return {
        ...node,
        parentId: groupId,
        extent: 'parent' as const,
        position: { x: node.position.x - groupPosition.x, y: node.position.y - groupPosition.y },
      };
    });
    setEditingGroupId(groupId);
    setNodes(decorateEditorNodes([groupNode, ...updatedNodes], groupId));
    setSelectedNodeId(groupId);
    setSelectedNodeIds([groupId]);
    setSelectedEdgeId(null);
  }, [canGroupSelection, decorateEditorNodes, groupableSelection, nodes, setNodes]);

  const handleUngroupSelection = useCallback(() => {
    if (!selectedGroupNode) return;
    const groupId = selectedGroupNode.id;
    const nextNodes = nodes.flatMap((node) => {
      if (node.id === groupId) return [];
      if (node.parentId !== groupId) return [node];
      return [removeNodeFromGroup(node, nodes)];
    });
    setEditingGroupId(null);
    setNodes(decorateEditorNodes(nextNodes, null));
    setSelectedNodeId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
  }, [decorateEditorNodes, nodes, selectedGroupNode, setNodes]);

  const handleRemoveFromGroup = useCallback(() => {
    if (!selectedChildNode) return;
    const nextNodes = nodes.map((node) =>
      node.id === selectedChildNode.id ? removeNodeFromGroup(node, nodes) : node,
    );
    setNodes(decorateEditorNodes(nextNodes));
    setSelectedNodeId(selectedChildNode.id);
    setSelectedNodeIds([selectedChildNode.id]);
    setSelectedEdgeId(null);
  }, [decorateEditorNodes, nodes, selectedChildNode, setNodes]);

  // ── Layout ────────────────────────────────────────────────────────────────────

  const triggerAutoLayout = useCallback(
    (rfInstance: import('reactflow').ReactFlowInstance | null) => {
      const nextNodes = decorateEditorNodes(layoutFlow(nodes, edges));
      setNodes(nextNodes);
      window.setTimeout(() => {
        void rfInstance?.fitView({ padding: 0.2, duration: 400 });
      }, 50);
    },
    [decorateEditorNodes, edges, nodes, setNodes],
  );

  return {
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    selectedNodeId,
    setSelectedNodeId,
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeId,
    setSelectedEdgeId,
    editingGroupId,
    setEditingGroupId,
    selectedNode,
    selectedEdge,
    selectedEdgeSourceNode,
    selectedGroupNode,
    canGroupSelection,
    canUngroupSelection,
    canRemoveFromGroupSelection,
    selectedChildNode,
    groupableSelection,
    decorateEditorNodes,
    deleteNode,
    deleteEdge,
    onConnect,
    onEdgeClick,
    onReconnect,
    onReconnectStart,
    handleNodeDragStop,
    handleSelectionChange,
    handleDragStart,
    handleDrop,
    handleGroupSelection,
    handleUngroupSelection,
    handleRemoveFromGroup,
    handlePaneClick,
    triggerAutoLayout,
    handleOpenSubmenuCallback,
    setHandleOpenSubmenuCallback,
  };
}
