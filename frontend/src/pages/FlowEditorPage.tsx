import { getApiError } from '../lib/apiError';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  MiniMap,
  Node,
  NodeChange,
  ReactFlowInstance,
} from 'reactflow';
import {
  createFlow,
  createFlowVersion,
  getContactNumbers,
  getFlow,
  getFlowBreadcrumb,
  listExtensions,
  listOperators,
  listFlowVersions,
  listQueues,
  listTrunks,
  renameFlow,
  updateFlow,
} from '../lib/api';
import type { BuilderNodeType, ContactNumber, ExtensionItem, FlowBreadcrumbItem, FlowDetail, FlowNodeData, FlowTree, FlowTreeChild, FlowVersionSummary, OperatorItem, QueueItem, SipTrunkItem } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import { FlowTreePanel } from '../components/FlowTreePanel';
import { FlowCanvasEdge } from '../components/builder/FlowCanvasEdge';
import { FlowCanvasNode } from '../components/builder/FlowCanvasNode';
import { FlowGroupNode } from '../components/builder/FlowGroupNode';
import { HuntNode } from '../components/nodes/HuntNode';
import { MenuGroupNode } from '../components/nodes/MenuGroupNode';
import { NodeConfigPanel } from '../components/builder/NodeConfigPanel';
import { FlowVersionPanel } from '../components/builder/FlowVersionPanel';
import { FlowVersionDiffSummary, NodeDiff, EdgeDiff, ConfigChange } from '../components/builder/FlowVersionDiffSummary';
import { FlowSimulator } from '../components/FlowSimulator/FlowSimulator';
import { useFlowData } from '../hooks/useFlowData';
import {
  attachEdgeMetadata,
  decorateNodes,
  removeNodeFromGroup,
  SUBFLOW_JUMP_NODE_ID_PREFIX,
  useFlowCanvas,
} from '../hooks/useFlowCanvas';
import styles from './FlowEditorPage.module.css';
import {
  applyAutoLayout,
  buildEditorSnapshot,
  buildClipboardSelection,
  buildPastedClipboardSelection,
  buildPendingSubmenuIgnoreBranches,
  buildSubflowJumpVisuals,
  createDraftFlow,
  createSavePayload,
  getFlowDefaultTimeoutMs,
  isValidMenuBranchValue,
  mapFlowToEdges,
  mapFlowToNodes,
  mapSnapshotToEdges,
  mapSnapshotToNodes,
  QUEUE_LOGIN_TIMEOUT_DEFAULT_MS,
  validateFlowBeforeSave,
  validateFlowTimeoutConfig,
  validateNodeConfigurations,
  isImmediateHangupFlow,
  makeVersionEdgeKey,
  minimapNodeColor,
  renderPaletteIcon,
  renameSubmenuFlowReferences,
  palette,
  miniMapSizeProps,
  sanitizeMenuBranchFlows,
} from './FlowEditorPage.helpers';
import { PageLayout } from '../components/common/PageLayout';
import { useWindowWidth } from '../hooks/useWindowWidth';

// ─── Node / edge type registries (stable references) ─────────────────────────

const nodeTypes = {
  flowNode: FlowCanvasNode,
  huntNode: HuntNode,
  menuNode: MenuGroupNode,
  group: FlowGroupNode,
};

const edgeTypes = {
  flowEdge: FlowCanvasEdge,
};

const AUTO_SAVE_DEBOUNCE_MS = 1200;
const PALETTE_GROUP_STORAGE_KEY = 'callytics_palette_groups';
const CONFIG_PANEL_WIDTH_STORAGE_KEY = 'callytics_flow_config_panel_width';
const CONFIG_PANEL_DEFAULT_WIDTH = 320;
const CONFIG_PANEL_MIN_WIDTH = 300;
const CONFIG_PANEL_MAX_WIDTH = 720;
const IMMEDIATE_HANGUP_PUBLISH_MESSAGE =
  'This flow hangs up immediately on every caller. Add at least one action node between Start and Hangup before publishing.';

interface PaletteGroupDefinition {
  id: string;
  label: string;
  types: BuilderNodeType[];
}

interface PaletteGroupWithItems extends PaletteGroupDefinition {
  items: typeof palette;
}

// Add future node types to the matching group here; unknown types fall back to OTHER.
const PALETTE_GROUPS: PaletteGroupDefinition[] = [
  {
    id: 'call-flow',
    label: 'CALL FLOW',
    types: ['start', 'play_audio', 'get_digits', 'business_hours', 'hangup'],
  },
  {
    id: 'routing',
    label: 'ROUTING',
    types: ['menu', 'transfer', 'hunt', 'queue', 'queue_login', 'conference'],
  },
  {
    id: 'caller-actions',
    label: 'CALLER ACTIONS',
    types: ['callback', 'voicemail', 'webhook'],
  },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
type EditorNoticeTone = 'error' | 'success';
type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
  isSubflowJump?: boolean;
  onDelete?: (edgeId: string) => void;
};
type PendingLeaveAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'history-back' }
  | { kind: 'breadcrumb'; flowId: number }
  | { kind: 'submenu'; nodeId: string; branch?: string };

type ClipboardNode = Node<FlowNodeData>;
type ClipboardEdge = Edge<BuilderEdgeData>;

function renameFlowTreeNode(tree: FlowTree | null, flowId: number, name: string): FlowTree | null {
  if (!tree) {
    return tree;
  }
  const renameChildren = (children: FlowTreeChild[]): FlowTreeChild[] =>
    children.map((child) => ({
      ...child,
      name: child.subflowId === flowId ? name : child.name,
      children: renameChildren(child.children),
    }));

  return {
    ...tree,
    children: renameChildren(tree.children),
  };
}

function renameBreadcrumbItems(items: FlowBreadcrumbItem[], flowId: number, name: string) {
  return items.map((item) => (item.flowId === flowId ? { ...item, flowName: name } : item));
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FlowEditorPage() {
  const windowWidth = useWindowWidth();
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isDraftRoute = id === 'new';
  const initialRouteFlowId = Number(id || 0);
  const draftPrefill = (location.state as {
    prefillTemplate?: {
      name?: string;
      nodes?: FlowDetail['nodes'];
      edges?: FlowDetail['edges'];
    };
  } | null)?.prefillTemplate;

  // ── Canvas refs ──────────────────────────────────────────────────────────────
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const fitDone = useRef(false);
  const pendingLeaveActionRef = useRef<PendingLeaveAction | null>(null);
  const allowNextPopStateRef = useRef(false);
  const userEditedRef = useRef(false);
  const copiedSelectionRef = useRef<{ nodes: ClipboardNode[]; edges: ClipboardEdge[] } | null>(null);
  const pendingSubmenuFocusRef = useRef<{ flowId: number; nodeKey: string } | null>(null);
  const configPanelResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const pastedHighlightTimerRef = useRef<number | null>(null);

  // ── Hooks ────────────────────────────────────────────────────────────────────
  const flowData = useFlowData(isDraftRoute);
  const canvas = useFlowCanvas();
  const { flow, setFlow, audioItems, breadcrumb, setBreadcrumb, flowTree, setFlowTree, treeRefreshKey, incrementTreeRefreshKey, versions, setVersions, versionsLoading, loadVersions, loadFlowTree, restoreVersion, loadBreadcrumb, loadVersionDetail } = flowData;
  const { nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, selectedNode, selectedEdge, selectedEdgeSourceNode, selectedGroupNode, canGroupSelection, canUngroupSelection, canRemoveFromGroupSelection, selectedChildNode, groupableSelection, decorateEditorNodes, deleteNode, deleteEdge, onConnect, isValidConnection, onEdgeClick, onReconnect, onReconnectStart, handleNodeDragStop, handleSelectionChange, handleDragStart, handleDrop, handleGroupSelection, handleUngroupSelection, handleRemoveFromGroup, handlePaneClick, triggerAutoLayout, setHandleOpenSubmenuCallback, selectedNodeId, setSelectedNodeId, selectedNodeIds, setSelectedNodeIds, selectedEdgeId, setSelectedEdgeId, editingGroupId, setEditingGroupId } = canvas;

  // ── Tracked Canvas Methods ───────────────────────────────────────────────────
  const handleGroupSelectionWithTracking = useCallback(() => {
    userEditedRef.current = true;
    handleGroupSelection();
  }, [handleGroupSelection]);

  const handleUngroupSelectionWithTracking = useCallback(() => {
    userEditedRef.current = true;
    handleUngroupSelection();
  }, [handleUngroupSelection]);

  const handleRemoveFromGroupWithTracking = useCallback(() => {
    userEditedRef.current = true;
    handleRemoveFromGroup();
  }, [handleRemoveFromGroup]);

  const triggerAutoLayoutWithTracking = useCallback((instance: ReactFlowInstance | null) => {
    userEditedRef.current = true;
    triggerAutoLayout(instance);
  }, [triggerAutoLayout]);

  // ── Editor-local state ───────────────────────────────────────────────────────
  const [currentFlowId, setCurrentFlowId] = useState<number>(initialRouteFlowId > 0 ? initialRouteFlowId : 0);
  const [rootFlowId, setRootFlowId] = useState<number>(initialRouteFlowId > 0 ? initialRouteFlowId : 0);
  const [isDraft, setIsDraft] = useState(isDraftRoute);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [editorNotice, setEditorNotice] = useState<string | null>(null);
  const [editorNoticeTone, setEditorNoticeTone] = useState<EditorNoticeTone>('error');
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionMessage, setVersionMessage] = useState('');
  const [versionSaveState, setVersionSaveState] = useState<'idle' | 'saving'>('idle');
  const [versionNotice, setVersionNotice] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<FlowVersionSummary | null>(null);
  const [compareVersion, setCompareVersion] = useState<import('../types').FlowVersionDetail | null>(null);
  const [currentVersionDetail, setCurrentVersionDetail] = useState<import('../types').FlowVersionDetail | null>(null);
  const [configPanelWidth, setConfigPanelWidth] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(CONFIG_PANEL_WIDTH_STORAGE_KEY);
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= CONFIG_PANEL_MIN_WIDTH && parsed <= CONFIG_PANEL_MAX_WIDTH) {
        return parsed;
      }
    } catch {
      // Ignore localStorage read failures and fall back to default width.
    }
    return CONFIG_PANEL_DEFAULT_WIDTH;
  });
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [contactNumbers, setContactNumbers] = useState<ContactNumber[]>([]);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [timeoutWarningConfirmVisible, setTimeoutWarningConfirmVisible] = useState(false);
  const [timeoutWarningMessage, setTimeoutWarningMessage] = useState<string | null>(null);
  const [loadRefError, setLoadRefError] = useState<string | null>(null);
  const [flowLoadError, setFlowLoadError] = useState<string | null>(null);
  const [isLoadingFlow, setIsLoadingFlow] = useState(!isDraftRoute);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pastedNodeIds, setPastedNodeIds] = useState<string[]>([]);
  const nodeValidationIssues = useMemo(() => validateNodeConfigurations(nodes, edges), [nodes, edges]);
  const nodeValidationMap = useMemo(
    () => new Map(nodeValidationIssues.map((issue) => [issue.nodeId, issue])),
    [nodeValidationIssues],
  );
  const paletteSearchRef = useRef<HTMLInputElement | null>(null);
  const [paletteSearchQuery, setPaletteSearchQuery] = useState('');
  const [paletteGroupCollapsed, setPaletteGroupCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(PALETTE_GROUP_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, value === true]),
      );
    } catch {
      return {};
    }
  });

  // ── Toast helpers ────────────────────────────────────────────────────────────
  const editorNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showEditorNotice = (msg: string | null, tone: EditorNoticeTone = 'error') => {
    setEditorNotice(msg);
    setEditorNoticeTone(tone);
    if (editorNoticeTimerRef.current) clearTimeout(editorNoticeTimerRef.current);
    if (msg) editorNoticeTimerRef.current = setTimeout(() => setEditorNotice(null), 6000);
  };
  useEffect(() => () => { if (editorNoticeTimerRef.current) clearTimeout(editorNoticeTimerRef.current); }, []);
  useEffect(() => () => { if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current); if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); }, []);
  useEffect(() => () => {
    if (pastedHighlightTimerRef.current) {
      window.clearTimeout(pastedHighlightTimerRef.current);
    }
  }, []);
  useEffect(() => {
    paletteSearchRef.current?.focus();
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_PANEL_WIDTH_STORAGE_KEY, String(configPanelWidth));
    } catch {
      // Ignore localStorage write failures.
    }
  }, [configPanelWidth]);
  useEffect(() => {
    if (windowWidth <= 1280) {
      configPanelResizeRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = configPanelResizeRef.current;
      if (!resizeState) return;
      const nextWidth = resizeState.startWidth + (resizeState.startX - event.clientX);
      const clampedWidth = Math.min(CONFIG_PANEL_MAX_WIDTH, Math.max(CONFIG_PANEL_MIN_WIDTH, nextWidth));
      setConfigPanelWidth(clampedWidth);
    };
    const handlePointerUp = () => {
      if (!configPanelResizeRef.current) return;
      configPanelResizeRef.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
  }, [windowWidth]);

  // Fetch routing resources on mount for NodeConfigPanel
  useEffect(() => {
    let active = true;
    const loadReferenceData = async () => {
      const [queuesRes, extensionsRes, operatorsRes, contactsRes, trunksRes] = await Promise.allSettled([
        listQueues(1, 200),
        listExtensions(200, 0),
        listOperators(1, 200),
        getContactNumbers(1, 200),
        listTrunks(200, 0),
      ]);
      if (!active) return;
      const failed: string[] = [];
      if (queuesRes.status === 'fulfilled') {
        setQueueItems(queuesRes.value.data);
      } else {
        failed.push('queues');
      }
      if (extensionsRes.status === 'fulfilled') {
        setExtensions(extensionsRes.value.data);
      } else {
        failed.push('extensions');
      }
      if (operatorsRes.status === 'fulfilled') {
        setOperators(operatorsRes.value.data);
      } else {
        failed.push('operators');
      }
      if (contactsRes.status === 'fulfilled') {
        setContactNumbers(contactsRes.value.data);
      } else {
        failed.push('contact numbers');
      }
      if (trunksRes.status === 'fulfilled') {
        setTrunks(trunksRes.value.data);
      } else {
        failed.push('trunks');
      }
      if (failed.length > 0) {
        setLoadRefError(`Failed to load: ${failed.join(', ')}. Node configuration options may be incomplete.`);
      }
    };
    void loadReferenceData();
    return () => { active = false; };
  }, []);

  // ── Route → flow id sync ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isDraftRoute && initialRouteFlowId > 0) { setCurrentFlowId(initialRouteFlowId); setRootFlowId(initialRouteFlowId); }
    if (isDraftRoute) { setBreadcrumb([]); setFlowTree(null); setRootFlowId(0); }
  }, [initialRouteFlowId, isDraftRoute, setBreadcrumb, setFlowTree]);

  // ── Flow tree ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isDraftRoute || rootFlowId <= 0) { setFlowTree(null); return; }
    let active = true;
    loadFlowTree(rootFlowId).then((tree) => { if (active) setFlowTree(tree); });
    return () => { active = false; };
  }, [isDraftRoute, rootFlowId, treeRefreshKey, loadFlowTree, setFlowTree]);

  useEffect(() => {
    if (!flow || isDraft) {
      setCurrentVersionDetail(null);
      return;
    }
    let active = true;
    loadVersionDetail(flow.id, flow.versionId)
      .then((detail) => {
        if (active) {
          setCurrentVersionDetail(detail);
        }
      })
      .catch(() => {
        if (active) {
          setCurrentVersionDetail(null);
        }
      });
    return () => {
      active = false;
    };
  }, [flow?.id, flow?.versionId, isDraft, loadVersionDetail]);

  // ── fitView after initial load ──────────────────────────────────────────────
  useEffect(() => {
    if (rfInstance && nodes.length > 0 && !fitDone.current) {
      fitDone.current = true;
      const timer = window.setTimeout(() => { void rfInstance.fitView({ padding: 0.2, duration: 300 }); }, 100);
      return () => { window.clearTimeout(timer); };
    }
  }, [rfInstance, nodes.length]);

  // ── handleOpenSubmenu — needs API + canvas state (stays in page) ─────────────
  // (getFlow, currentFlowId) and canvas state (setBreadcrumb, setCurrentFlowId).
  const handleOpenSubmenu = useCallback(async (nodeId: string, branch?: string) => {
    if (isDraft || currentFlowId <= 0) { showEditorNotice('Save this flow before opening a submenu.'); return; }
    const canLeave = await ensureSavedBeforeNavigation();
    if (!canLeave) {
      requestLeave({ kind: 'submenu', nodeId, branch });
      return;
    }
    try {
      const response = await getFlow(String(currentFlowId));
      const menuNode = response.data.nodes.find((node) => node.nodeKey === nodeId);
      const submenuFlows = sanitizeMenuBranchFlows(menuNode?.config?.submenu_branch_flows);
      const selectedBranch = branch || Object.keys(submenuFlows)[0] || null;
      const submenuFlow = selectedBranch ? submenuFlows[selectedBranch] : null;
      if (!selectedBranch || !submenuFlow) { showEditorNotice('Branch submenu is missing. Create it from branch routing first.'); return; }
      pendingSubmenuFocusRef.current = null;
      showEditorNotice(null);
      setCurrentFlowId(submenuFlow.flowId);
    } catch { showEditorNotice('Failed to open submenu.'); }
  }, [currentFlowId, isDraft]);

  // Register handleOpenSubmenu with the canvas hook so decorateEditorNodes can call it
  useEffect(() => {
    setHandleOpenSubmenuCallback(() => handleOpenSubmenu);
  }, [handleOpenSubmenu, setHandleOpenSubmenuCallback]);

  // ── Main load effect ─────────────────────────────────────────────────────────
  // (DOM ref), calls decorateEditorNodes and attachEdgeMetadata (canvas helpers),
  // and writes to ~8 canvas setters. Moving it would need a canvas-aware loader.
  useEffect(() => {
    fitDone.current = false;
    setIsInitialized(false);
    setIsDraft(isDraftRoute);
    setFlowLoadError(null);
    let active = true;
    const load = async () => {
      if (!isDraftRoute) {
        setIsLoadingFlow(true);
      }
      try {
      if (isDraftRoute) {
        const draftFlow = createDraftFlow();
        const draftSourceFlow: FlowDetail = {
          ...draftFlow,
          name: String(draftPrefill?.name || draftFlow.name),
          nodes: Array.isArray(draftPrefill?.nodes) ? draftPrefill.nodes : [],
          edges: Array.isArray(draftPrefill?.edges) ? draftPrefill.edges : [],
        };
        const defaultDraftNodes: Array<Node<FlowNodeData>> = [
          {
            id: 'start',
            type: 'flowNode',
            position: { x: 120, y: 140 },
            data: { label: 'Start', type: 'start', config: {}, subflowId: null },
            draggable: false,
          },
        ];
        const mappedDraftNodes = draftSourceFlow.nodes.length > 0
          ? mapFlowToNodes(draftSourceFlow)
          : defaultDraftNodes;
        const mappedDraftEdges = draftSourceFlow.edges.length > 0
          ? attachEdgeMetadata(mapFlowToEdges(draftSourceFlow), mappedDraftNodes, handleDeleteEdgeWithUserTracking)
          : [];
        const draftNodes = decorateEditorNodes(mappedDraftNodes, null);
        if (!active) return;
        setFlow(draftSourceFlow); setBreadcrumb([]); setNodes(draftNodes); setEdges(mappedDraftEdges); setSavedSnapshot(null);
        userEditedRef.current = false;
        setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(null); setEditingGroupId(null); setIsInitialized(true); return;
      }
      if (currentFlowId <= 0) return;
      const [response, breadcrumbResponse] = await Promise.all([getFlow(String(currentFlowId)), getFlowBreadcrumb(currentFlowId)]);
      if (!active) return;
      const nextRootFlowId = breadcrumbResponse.data[0]?.flowId ?? response.data.id;
      setFlow(response.data); setBreadcrumb(breadcrumbResponse.data);
      setRootFlowId(nextRootFlowId);
      const mappedNodes = mapFlowToNodes(response.data);
      const nextNodes = decorateEditorNodes(mappedNodes, null);
      const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, handleDeleteEdgeWithUserTracking);
      const pendingFocus = pendingSubmenuFocusRef.current;
      const focusedNodeId = pendingFocus?.flowId === response.data.id
        ? nextNodes.find((node) => node.id === pendingFocus.nodeKey)?.id || null
        : null;
      setNodes(nextNodes); setEdges(nextEdges); setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
      userEditedRef.current = false;
      setSelectedNodeId(focusedNodeId); setSelectedNodeIds(focusedNodeId ? [focusedNodeId] : []); setSelectedEdgeId(null); setEditingGroupId(null); setIsInitialized(true);
      if (focusedNodeId) {
        pendingSubmenuFocusRef.current = null;
      }
      } catch (error) {
        if (!active) return;
        const msg = getApiError(error, 'failed to load flow');
        setFlowLoadError(msg);
      } finally {
        if (active) setIsLoadingFlow(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [currentFlowId, draftPrefill, isDraftRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNodesChangeWithUserTracking = useCallback((changes: NodeChange[]) => {
    const hasUserEdit = changes.some((change) => (
      change.type === 'add'
      || change.type === 'remove'
      || change.type === 'position'
    ));
    if (hasUserEdit) {
      userEditedRef.current = true;
    }
    onNodesChange(changes);
  }, [onNodesChange]);

  const handleEdgesChangeWithUserTracking = useCallback((changes: EdgeChange[]) => {
    const hasUserEdit = changes.some((change) => (
      change.type === 'add'
      || change.type === 'remove'
    ));
    if (hasUserEdit) {
      userEditedRef.current = true;
    }
    onEdgesChange(changes);
  }, [onEdgesChange]);

  const handleConnectWithUserTracking = useCallback((connection: Connection) => {
    userEditedRef.current = true;
    onConnect(connection);
  }, [onConnect]);

  const handleReconnectWithUserTracking = useCallback((oldEdge: Edge, newConnection: Connection) => {
    userEditedRef.current = true;
    onReconnect(oldEdge, newConnection);
  }, [onReconnect]);

  const handleDeleteEdgeWithUserTracking = useCallback((edgeId: string) => {
    userEditedRef.current = true;
    deleteEdge(edgeId);
  }, [deleteEdge]);

  // ── Computed state ──────────────────────────────────────────────────────────
  const hasUnsavedChanges = useMemo(() => {
    if (!isInitialized || !flow) return false;
    if (isDraft) return true;
    if (savedSnapshot === null) return false;
    return buildEditorSnapshot(flow, nodes, edges) !== savedSnapshot;
  }, [edges, flow, isDraft, isInitialized, nodes, savedSnapshot]);

  const isSubflow = breadcrumb.length > 1;
  const showConfigPanel = selectedNode !== null || selectedEdge !== null;
  const canResizeConfigPanel = windowWidth > 1280;
  const editorShellStyle = canResizeConfigPanel
    ? {
        gridTemplateColumns: showConfigPanel
          ? `220px minmax(0, 1fr) 10px ${configPanelWidth}px`
          : '220px minmax(0, 1fr)',
      }
    : undefined;
  const paletteGroups = useMemo<PaletteGroupWithItems[]>(() => {
    const grouped = PALETTE_GROUPS.map((group) => ({
      ...group,
      items: palette.filter((item) => group.types.includes(item.type)),
    }));
    const mappedTypes = new Set(grouped.flatMap((group) => group.items.map((item) => item.type)));
    const otherItems = palette.filter((item) => !mappedTypes.has(item.type));
    if (otherItems.length > 0) {
      grouped.push({
        id: 'other',
        label: 'OTHER',
        types: [],
        items: otherItems,
      });
    }
    return grouped;
  }, []);
  const normalizedPaletteSearchQuery = paletteSearchQuery.trim().toLowerCase();
  const paletteSearchMatches = useMemo(
    () =>
      palette.filter((item) => (
        item.type.toLowerCase().includes(normalizedPaletteSearchQuery)
        || item.label.toLowerCase().includes(normalizedPaletteSearchQuery)
      )),
    [normalizedPaletteSearchQuery],
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(
        PALETTE_GROUP_STORAGE_KEY,
        JSON.stringify(paletteGroupCollapsed),
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [paletteGroupCollapsed]);

  const paletteDescription = useCallback((type: string) => {
    if (type === 'webhook') return 'Fires an async HTTP POST in parallel. Does not block the call flow.';
    return '';
  }, []);

  const renderPaletteNodeCard = useCallback((item: (typeof palette)[number]) => (
    <div className={styles.paletteItem} draggable={item.type !== 'start'} key={item.type} onDragStart={() => handleDragStart(item.type)} title={item.type === 'start' ? 'Seed flows already contain the required start node' : 'Drag onto canvas'}>
      <span className={`${styles.paletteBar} ${styles[`bar${item.type.replace(/_/g, '')}`]}`} />
      {renderPaletteIcon(item.type)}
      <div className={styles.paletteItemContent}>
        <div className={styles.paletteType}>{item.type}</div>
        <div className={styles.paletteLabel}>{item.label}</div>
        {paletteDescription(item.type) ? <div className={styles.paletteDescription}>{paletteDescription(item.type)}</div> : null}
      </div>
    </div>
  ), [handleDragStart, paletteDescription]);

  // ── Versions panel load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!versionsOpen || !flow || isDraft || flow.id <= 0) return;
    void loadVersions(flow.id);
  }, [flow, isDraft, versionsOpen, loadVersions]);

  useEffect(() => { if (isSubflow && versionsOpen) setVersionsOpen(false); }, [isSubflow, versionsOpen]);

  // ── Navigation guards ────────────────────────────────────────────────────────
  const performLeaveAction = useCallback((action: PendingLeaveAction) => {
    if (action.kind === 'breadcrumb') {
      setBreadcrumb((current) => {
        const index = current.findIndex((item) => item.flowId === action.flowId);
        return index >= 0 ? current.slice(0, index + 1) : current;
      });
      setCurrentFlowId(action.flowId);
      showEditorNotice(null);
      return;
    }
    if (action.kind === 'submenu') {
      void handleOpenSubmenu(action.nodeId, action.branch);
      return;
    }
    if (action.kind === 'navigate') { navigate(action.to); return; }
    if (action.kind === 'external') { window.location.assign(action.href); return; }
    allowNextPopStateRef.current = true; window.history.back();
  }, [handleOpenSubmenu, navigate, setBreadcrumb]);

  const requestLeave = useCallback((action: PendingLeaveAction) => {
    if (!hasUnsavedChanges) { performLeaveAction(action); return; }
    pendingLeaveActionRef.current = action; setConfirmLeaveOpen(true);
  }, [hasUnsavedChanges, performLeaveAction]);

  useEffect(() => { if (!hasUnsavedChanges && confirmLeaveOpen) { pendingLeaveActionRef.current = null; setConfirmLeaveOpen(false); } }, [confirmLeaveOpen, hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const message = 'You have unsaved changes. Leave anyway?';
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = message; return message; };
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const handleDocumentClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href === currentPath) return;
      if (anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const nextUrl = new URL(anchor.href, window.location.href);
      event.preventDefault(); event.stopPropagation();
      if (nextUrl.origin === window.location.origin) { requestLeave({ kind: 'navigate', to: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` }); return; }
      requestLeave({ kind: 'external', href: nextUrl.toString() });
    };
    const handlePopState = () => {
      if (allowNextPopStateRef.current) { allowNextPopStateRef.current = false; return; }
      window.history.pushState(null, '', currentPath); requestLeave({ kind: 'history-back' });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('popstate', handlePopState);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', handleDocumentClick, true); window.removeEventListener('popstate', handlePopState); };
  }, [hasUnsavedChanges, requestLeave]);

  // ── Keyboard handler (Delete / Backspace) ────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (selectedNodeIds.length === 0) return;
        event.preventDefault();
        copySelectedNodes();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        if (!copiedSelectionRef.current) return;
        event.preventDefault();
        pasteSelectedNodes();
        return;
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (selectedEdgeId) { event.preventDefault(); userEditedRef.current = true; deleteEdge(selectedEdgeId); return; }
      if (selectedNodeIds.length === 1 && selectedGroupNode) { event.preventDefault(); handleUngroupSelectionWithTracking(); return; }
      if (selectedNodeIds.length === 0) return;
      const deletableNodeIds = selectedNodeIds.filter((nodeId) => (
        nodes.find((node) => node.id === nodeId)?.data.type !== 'start'
      ));
      if (deletableNodeIds.length === 0) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      userEditedRef.current = true;
      for (const nodeId of deletableNodeIds) deleteNode(nodeId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelectedNodes, deleteEdge, deleteNode, handleUngroupSelectionWithTracking, nodes, pasteSelectedNodes, selectedEdgeId, selectedGroupNode, selectedNodeIds]);

  const saveFlow = async (
    versionMessage?: string,
    options?: {
      auto?: boolean;
      allowTimeoutWarningBypass?: boolean;
      pendingSubmenuRoute?: { nodeId: string; branch: string };
    },
  ): Promise<FlowDetail | null> => {
    if (!flow) return null;
    if (saveInFlightRef.current) return null;
    if (!options?.auto && !isDraft && isInitialized && !hasUnsavedChanges) {
      setSaveState('saved');
      showEditorNotice(null);
      if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current);
      saveFeedbackTimer.current = window.setTimeout(() => setSaveState('idle'), 2000);
      return flow;
    }
    if (!options?.auto) setSaveAttempted(true);
    if (isImmediateHangupFlow(nodes, edges)) {
      if (!options?.auto) {
        setSaveState('failed');
        showEditorNotice(IMMEDIATE_HANGUP_PUBLISH_MESSAGE);
      }
      return null;
    }
    if (!options?.auto) {
      const timeoutValidation = validateFlowTimeoutConfig(nodes, { isSubflow: Boolean(flow.parentFlowId) });
      if (timeoutValidation.errors.length > 0) {
        setSaveState('failed');
        showEditorNotice(timeoutValidation.errors[0]);
        return null;
      }
      if (timeoutValidation.warningCount > 0 && !options?.allowTimeoutWarningBypass) {
        setTimeoutWarningConfirmVisible(true);
        setTimeoutWarningMessage(
          `${timeoutValidation.warningCount} node(s) will have no effective timeout because flow default is unset. Save anyway?`,
        );
        return null;
      }
      setTimeoutWarningConfirmVisible(false);
      setTimeoutWarningMessage(null);
    }
    const validationError = await validateFlowBeforeSave(nodes, edges, {
      ignoreMenuBranches: buildPendingSubmenuIgnoreBranches(nodes, edges, options?.pendingSubmenuRoute),
    });
    if (validationError) { if (!options?.auto) { setSaveState('failed'); showEditorNotice(validationError); } return null; }
    if (nodeValidationIssues.length > 0 && !options?.auto) {
      if (!options?.auto) {
        setSaveState('failed');
        showEditorNotice(nodeValidationIssues.map((issue) => `${issue.nodeLabel}: ${issue.issues.join(', ')}`).join(' | '));
      }
      return null;
    }
    saveInFlightRef.current = true; setSaveState('saving');
    try {
      const payload = createSavePayload(flow, nodes, edges, versionMessage, { autoSave: Boolean(options?.auto) });
      const response = isDraft ? await createFlow(payload) : await updateFlow(String(currentFlowId), payload);
      setFlow(response.data);
      if (isDraft) setRootFlowId(response.data.id);
      setCurrentFlowId(response.data.id); setIsDraft(false);
      const shouldRefreshCanvasFromServer = !options?.auto || isDraft;
      if (shouldRefreshCanvasFromServer) {
        const mappedNodes = mapFlowToNodes(response.data);
        const nextNodes = decorateEditorNodes(mappedNodes, null);
        const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, handleDeleteEdgeWithUserTracking);
        setNodes(nextNodes); setEdges(nextEdges); setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
        window.setTimeout(() => { void rfInstance?.fitView({ padding: 0.2, duration: 300 }); }, 150);
      } else {
        // Preserve current selection/panel state during debounced autosave.
        setSavedSnapshot(buildEditorSnapshot(response.data, nodes, edges));
      }
      userEditedRef.current = false;
      if (!options?.auto) {
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        setSelectedEdgeId(null);
        setEditingGroupId(null);
      }
      showEditorNotice(null);
      if (response.data.id > 0) {
        const [refreshedVersions, breadcrumbResponse] = await Promise.all([listFlowVersions(response.data.id), getFlowBreadcrumb(response.data.id)]);
        const nextRootFlowId = breadcrumbResponse.data[0]?.flowId ?? response.data.id;
        setVersions(refreshedVersions.data); setBreadcrumb(breadcrumbResponse.data); setRootFlowId(nextRootFlowId); incrementTreeRefreshKey();
      }
      setSaveState('saved');
      if (!options?.auto) setSaveAttempted(false);
      if (isDraft) navigate(`/flows/${response.data.id}`, { replace: true });
      return response.data;
    } catch (error) {
      if (!options?.auto) {
        const apiMsg = getApiError(error, 'failed to save flow');
        const isNodeConfigError = apiMsg.startsWith('Node ');
        if (isNodeConfigError) {
          setSaveAttempted(true);
        } else {
          setSaveState('failed'); showEditorNotice(apiMsg);
        }
      }
      return null;
    } finally {
      saveInFlightRef.current = false;
      if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current);
      saveFeedbackTimer.current = window.setTimeout(() => setSaveState('idle'), 2000);
    }
  };

  const handleOpenOrCreateSubmenu = useCallback(async (nodeId: string, branch?: string) => {
    const selectedMenuNode = nodes.find((node) => node.id === nodeId && node.data.type === 'menu') || null;
    if (!selectedMenuNode) {
      return;
    }
    const submenuFlows = sanitizeMenuBranchFlows(selectedMenuNode.data.config.submenu_branch_flows);
    if (branch && submenuFlows[branch]) {
      await handleOpenSubmenu(nodeId, branch);
      return;
    }
    if (!branch) {
      const firstBranch = Object.keys(submenuFlows)[0];
      if (firstBranch) {
        await handleOpenSubmenu(nodeId, firstBranch);
      } else {
        showEditorNotice('Choose a branch from branch routing to create a submenu.');
      }
      return;
    }

    let activeFlow = flow;
    if (!activeFlow || isDraft || currentFlowId <= 0 || hasUnsavedChanges) {
      const saved = await saveFlow(undefined, { pendingSubmenuRoute: { nodeId, branch } });
      if (!saved) {
        return;
      }
      activeFlow = saved;
    }

    const branchNames = typeof selectedMenuNode.data.config.submenu_branch_names === 'object' && selectedMenuNode.data.config.submenu_branch_names
      ? selectedMenuNode.data.config.submenu_branch_names as Record<string, string>
      : {};
    const defaultSubmenuName = `${activeFlow.name} — ${selectedMenuNode.data.label || 'Menu'} branch ${branch} submenu`;
    const submenuName = String(branchNames[branch] || '').trim() || defaultSubmenuName;

    try {
      const response = await createFlow({
        name: submenuName,
        description: '',
        parentFlowId: activeFlow.id,
        parentNodeKey: nodeId,
        parentBranchKey: branch,
        nodes: [
          {
            nodeKey: 'start',
            type: 'start',
            label: 'Start',
            positionX: 120,
            positionY: 140,
            config: {},
            groupId: null,
            subflowId: null,
          },
        ],
        edges: [],
      });
      pendingSubmenuFocusRef.current = null;
      incrementTreeRefreshKey();
      showEditorNotice(null);
      setCurrentFlowId(response.data.id);
    } catch (error) {
      showEditorNotice(getApiError(error, 'failed to create submenu'));
    }
  }, [currentFlowId, flow, handleOpenSubmenu, hasUnsavedChanges, incrementTreeRefreshKey, isDraft, nodes, saveFlow]);

  const handleRenameSubmenu = useCallback(async (flowId: number, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    await renameFlow(flowId, trimmedName);
    setNodes((current) => decorateEditorNodes(renameSubmenuFlowReferences(current, flowId, trimmedName)));
    if (flow?.id === flowId) {
      setFlow((current) => (current ? { ...current, name: trimmedName } : current));
    }
    setBreadcrumb((current) => renameBreadcrumbItems(current, flowId, trimmedName));
    setFlowTree((current) => renameFlowTreeNode(current, flowId, trimmedName));
    incrementTreeRefreshKey();
  }, [decorateEditorNodes, flow?.id, incrementTreeRefreshKey, setBreadcrumb, setFlow, setFlowTree, setNodes]);

  function copySelectedNodes() {
    const copied = buildClipboardSelection(nodes, edges, selectedNodeIds);
    if (!copied) {
      return;
    }
    copiedSelectionRef.current = copied;
    showEditorNotice(`Copied ${copied.nodes.length} node${copied.nodes.length === 1 ? '' : 's'}.`, 'success');
  }

  function pasteSelectedNodes() {
    const copied = copiedSelectionRef.current;
    if (!copied || copied.nodes.length === 0) {
      return;
    }

    const existingStartNodeId = nodes.find((node) => node.data.type === 'start')?.id ?? null;
    const { nodes: nextNodes, edges: nextEdges } = buildPastedClipboardSelection(copied, {
      existingStartNodeId,
    });
    if (nextNodes.length === 0) {
      return;
    }

    userEditedRef.current = true;
    setNodes((current) => decorateEditorNodes([...current, ...nextNodes]));
    setEdges((current) => attachEdgeMetadata([...current, ...nextEdges], [...nodes, ...nextNodes], handleDeleteEdgeWithUserTracking));
    setSelectedNodeId(nextNodes[0]?.id || null);
    setSelectedNodeIds(nextNodes.map((node) => node.id));
    setSelectedEdgeId(null);
    setPastedNodeIds(nextNodes.map((node) => node.id));
    if (pastedHighlightTimerRef.current) {
      window.clearTimeout(pastedHighlightTimerRef.current);
    }
    pastedHighlightTimerRef.current = window.setTimeout(() => setPastedNodeIds([]), 2500);
    showEditorNotice(`Pasted ${nextNodes.length} node${nextNodes.length === 1 ? '' : 's'}.`, 'success');
  }

  // ── Editor auto-save ─────────────────────────────────────────────────────────
  // Root flows and nested subflows share the same debounced persistence path.
  useEffect(() => {
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    if (!hasUnsavedChanges || !isInitialized || !flow || isDraft || flow.id <= 0) {
      return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
    }
    autoSaveTimer.current = window.setTimeout(() => {
      void saveFlow(undefined, { auto: true });
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
  }, [hasUnsavedChanges, isInitialized, flow, isDraft, versionSaveState, saveState, confirmLeaveOpen, compareVersion, nodeValidationIssues.length]);

  // ── Config panel handlers ────────────────────────────────────────────────────
  const handleLabelChange = (value: string) => {
    if (!selectedNodeId) return;
    userEditedRef.current = true;
    setNodes((current) => decorateEditorNodes(current.map((node) => {
      if (node.id !== selectedNodeId) return node;
      if (node.data.label === value) return node;
      return { ...node, data: { ...node.data, label: value } };
    })));
  };
  const handleConfigValueChange = (field: string, value: unknown) => {
    if (!selectedNodeId) return;
    userEditedRef.current = true;
    setNodes((current) => decorateEditorNodes(current.map((node) => {
      if (node.id !== selectedNodeId) return node;
      if (node.data.config[field] === value) return node;
      return { ...node, data: { ...node.data, config: { ...node.data.config, [field]: value } } };
    })));
  };
  const numericFields = new Set([
    'timeout_ms',
    'attempt_timeout_ms',
    'total_timeout_ms',
    'max_timeout_attempts',
    'max_invalid_attempts',
    'max_duration_seconds',
    'input_timeout_ms',
    'queue_login_default_input_timeout_ms',
    'flow_default_timeout_ms',
  ]);
  const timeoutFields = new Set([
    'timeout_ms',
    'attempt_timeout_ms',
    'total_timeout_ms',
    'input_timeout_ms',
    'queue_login_default_input_timeout_ms',
    'flow_default_timeout_ms',
  ]);
  const handleConfigChange = (field: string, value: string) => {
    if (!numericFields.has(field)) {
      handleConfigValueChange(field, value);
      return;
    }
    if (timeoutFields.has(field) && value.trim() === '') {
      handleConfigValueChange(field, null);
      return;
    }
    const numeric = Number(value);
    handleConfigValueChange(field, Number.isFinite(numeric) ? numeric : 0);
  };
  const handleMenuBranchToggle = (branch: string, checked: boolean) => {
    const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
    const currentBranches = (Array.isArray(selectedConfig.branches) ? selectedConfig.branches as string[] : ['1', '2']).filter((b) => isValidMenuBranchValue(String(b)));
    const nextBranches = checked ? Array.from(new Set([...currentBranches, branch])) : currentBranches.filter((value) => value !== branch);
    handleConfigValueChange('branches', nextBranches);
    if (!checked) {
      const currentBranchNames = { ...(typeof selectedConfig.submenu_branch_names === 'object' && selectedConfig.submenu_branch_names ? selectedConfig.submenu_branch_names as Record<string, string> : {}) };
      if (currentBranchNames[branch]) {
        delete currentBranchNames[branch];
        handleConfigValueChange('submenu_branch_names', currentBranchNames);
      }
    }
  };
  const handleConfigReplace = (nextConfig: Record<string, unknown>) => {
    if (!selectedNodeId) return;
    userEditedRef.current = true;
    const nextSerialized = JSON.stringify(nextConfig);
    setNodes((current) => decorateEditorNodes(current.map((node) => {
      if (node.id !== selectedNodeId) return node;
      if (JSON.stringify(node.data.config) === nextSerialized) return node;
      return { ...node, data: { ...node.data, config: nextConfig } };
    })));
  };
  const handleEdgeConditionChange = (value: string | null) => {
    if (!selectedEdgeId) return;
    const selectedEdgeRecord = edges.find((edge) => edge.id === selectedEdgeId) || null;
    const selectedSourceNode = selectedEdgeRecord
      ? nodes.find((node) => node.id === selectedEdgeRecord.source) || null
      : null;
    const trimmedValue = value?.trim() || null;
    if (selectedSourceNode?.data.type === 'get_digits' && trimmedValue && !/^(?:\d{1,2}|\*|#|timeout|invalid|default)$/.test(trimmedValue)) {
      return;
    }
    if (selectedSourceNode?.data.type === 'menu' && trimmedValue && trimmedValue !== 'complete' && !/^(?:\d{1,2}|\*|#)$/.test(trimmedValue)) {
      return;
    }
    userEditedRef.current = true;
    setEdges((current) => attachEdgeMetadata(current.map((edge) => edge.id !== selectedEdgeId ? edge : { ...edge, data: { branchKey: trimmedValue || 'default', condition: trimmedValue, sourceNodeType: String(edge.data?.sourceNodeType || nodes.find((node) => node.id === edge.source)?.data.type || 'hangup'), onDelete: () => handleDeleteEdgeWithUserTracking(edge.id) } }), nodes, handleDeleteEdgeWithUserTracking));
  };

  const selectedMenuLocalEdgeBranches = useMemo(
    () => new Set(edges.filter((edge) => edge.source === selectedNodeId).map((edge) => { const resolved = String(edge.data?.condition || edge.data?.branchKey || '').trim(); return isValidMenuBranchValue(resolved) ? resolved : null; }).filter((value): value is string => Boolean(value))),
    [edges, selectedNodeId],
  );

  // ── Version handlers ─────────────────────────────────────────────────────────
  const ensureSavedBeforeNavigation = async (): Promise<boolean> => {
    if (!hasUnsavedChanges) return true;
    // Try to auto-save before navigating
    const saved = await saveFlow(undefined, { auto: true });
    return saved !== null;
  };
  const handleBreadcrumbNavigate = async (flowId: number) => {
    const canNavigate = await ensureSavedBeforeNavigation();
    if (!canNavigate) {
      requestLeave({ kind: 'breadcrumb', flowId });
      return;
    }
    setBreadcrumb((current) => { const index = current.findIndex((item) => item.flowId === flowId); return index >= 0 ? current.slice(0, index + 1) : current; });
    setCurrentFlowId(flowId); showEditorNotice(null);
  };
  const handleCreateVersion = async () => {
    if (!flow) return;
    if (isImmediateHangupFlow(nodes, edges)) {
      setVersionNotice(IMMEDIATE_HANGUP_PUBLISH_MESSAGE);
      return;
    }
    const trimmed = versionMessage.trim();
    if (!trimmed) return;
    setVersionSaveState('saving'); setVersionNotice(null);
    let activeFlow = flow;
    if (hasUnsavedChanges) {
      const saved = await saveFlow(trimmed);
      if (!saved) { setVersionSaveState('idle'); return; }
      activeFlow = saved; setVersionMessage(''); setVersionNotice('Flow saved and version committed.'); setVersionSaveState('idle'); return;
    }
    try {
      await createFlowVersion(activeFlow.id, trimmed);
      setVersionMessage(''); setVersionNotice('Version committed.');
      const refreshed = await listFlowVersions(activeFlow.id);
      setVersions(refreshed.data);
    } catch (error) {
      setVersionNotice(getApiError(error, 'failed to publish flow version'));
    } finally {
      setVersionSaveState('idle');
    }
  };
  const handleConfirmRestore = async () => {
    if (!pendingRestoreVersion || !flow) return;
    setIsRestoring(true);
    try {
    const restored = await flowData.restoreVersion(flow.id, pendingRestoreVersion.id);
    if (!restored) return;
    const breadcrumbResponse = await flowData.loadBreadcrumb(flow.id);
    setFlow(restored); setBreadcrumb(breadcrumbResponse); incrementTreeRefreshKey(); setIsDraft(false);
    const nextNodes = decorateEditorNodes(mapFlowToNodes(restored), null);
    const nextEdges = attachEdgeMetadata(mapFlowToEdges(restored), nextNodes, handleDeleteEdgeWithUserTracking);
    setNodes(nextNodes); setEdges(nextEdges); setSavedSnapshot(buildEditorSnapshot(restored, nextNodes, nextEdges));
    userEditedRef.current = false;
    setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(null); setEditingGroupId(null);
    setPendingRestoreVersion(null); setRestoreConfirmOpen(false);
    } finally {
      setIsRestoring(false);
    }
  };
  const handleCompareVersion = async (version: FlowVersionSummary) => {
    if (!flow) return;
    const detail = await flowData.loadVersionDetail(flow.id, version.id);
    if (detail) setCompareVersion(detail);
  };

  // ── Canvas visuals ──────────────────────────────────────────────────────────
  const { canvasNodes, canvasEdges } = useMemo(() => {
    const visuals = buildSubflowJumpVisuals(nodes, edges);
    return {
      canvasNodes: [...nodes, ...visuals.nodes].map((node) =>
        String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)
          ? node
          : {
              ...node,
              data: {
                ...node.data,
                diffColor: pastedNodeIds.includes(node.id) ? '--primitive-amber' : undefined,
                hasValidationError: nodeValidationMap.has(node.id),
                validationIssues: nodeValidationMap.get(node.id)?.issues ?? [],
              },
            },
      ),
      canvasEdges: [...edges, ...visuals.edges],
    };
  }, [edges, nodeValidationMap, nodes, pastedNodeIds]);

  // ── Diff overlay ─────────────────────────────────────────────────────────────
  const currentSnapshot = currentVersionDetail?.snapshot ?? {
    flowId: flow?.id ?? 0,
    name: flow?.name ?? '',
    nodes: nodes.map((node) => ({
      nodeKey: node.id,
      type: node.data.type,
      label: node.data.label ?? null,
      positionX: node.position.x,
      positionY: node.position.y,
      config: node.data.config,
      groupId: node.parentId ?? null,
      subflowId: node.data.subflowId ?? null,
    })),
    edges: edges.map((edge) => ({
      sourceNodeKey: edge.source,
      targetNodeKey: edge.target,
      branchKey: String(edge.data?.branchKey || edge.data?.condition || 'default'),
      condition: edge.data?.condition ?? null,
    })),
  };

  const compareSnapshotNodes = compareVersion ? mapSnapshotToNodes(compareVersion.snapshot) : [];
  const compareSnapshotEdges = compareVersion ? mapSnapshotToEdges(compareVersion.snapshot) : [];
  const currentSnapshotNodes = mapSnapshotToNodes(currentSnapshot);
  const currentSnapshotEdges = mapSnapshotToEdges(currentSnapshot);

  const currentNodeIds = new Set(currentSnapshotNodes.map((node) => node.id));
  const snapshotNodeIds = new Set(compareSnapshotNodes.map((node) => node.id));

  const addedNodeIds = new Set(currentSnapshotNodes.filter((node) => !snapshotNodeIds.has(node.id)).map((node) => node.id));
  const removedNodeIds = new Set(compareSnapshotNodes.filter((node) => !currentNodeIds.has(node.id)).map((node) => node.id));

  const calculateConfigDiff = (prev: Record<string, any>, curr: Record<string, any>): ConfigChange[] => {
    const diffs: ConfigChange[] = [];
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
    for (const key of allKeys) {
      if (key === 'submenu_branch_flows') continue; // derived, not stored
      const p = prev[key];
      const c = curr[key];
      if (JSON.stringify(p) !== JSON.stringify(c)) {
        diffs.push({ field: key, prev: p, curr: c });
      }
    }
    return diffs;
  };

  const changedNodesData: NodeDiff[] = currentSnapshotNodes.filter((curr) => {
    const prev = compareSnapshotNodes.find((n) => n.id === curr.id);
    if (!prev) return false;
    return (
      curr.data.type !== prev.data.type ||
      curr.data.label !== prev.data.label ||
      JSON.stringify(curr.data.config) !== JSON.stringify(prev.data.config)
    );
  }).map((curr) => {
    const prev = compareSnapshotNodes.find((n) => n.id === curr.id)!;
    return {
      id: String(curr.id),
      label: curr.data.label || '',
      type: curr.data.type,
      configDiff: calculateConfigDiff(prev.data.config, curr.data.config),
    };
  });

  const changedNodeIds = new Set(changedNodesData.map((n) => n.id));

  const currentEdgeKeys = new Set(currentSnapshotEdges.map((edge) => makeVersionEdgeKey(edge)));
  const snapshotEdgeKeys = new Set(compareSnapshotEdges.map((edge) => makeVersionEdgeKey(edge)));

  const addedEdgeData: EdgeDiff[] = currentSnapshotEdges
    .filter((edge) => !snapshotEdgeKeys.has(makeVersionEdgeKey(edge)))
    .map((edge) => ({
      key: makeVersionEdgeKey(edge),
      source: String(edge.source),
      target: String(edge.target),
      branch: String(edge.data?.branchKey || edge.data?.condition || 'default'),
    }));

  const removedEdgeData: EdgeDiff[] = compareSnapshotEdges
    .filter((edge) => !currentEdgeKeys.has(makeVersionEdgeKey(edge)))
    .map((edge) => ({
      key: makeVersionEdgeKey(edge),
      source: String(edge.source),
      target: String(edge.target),
      branch: String(edge.data?.branchKey || edge.data?.condition || 'default'),
    }));

  const addedNodesData: NodeDiff[] = currentSnapshotNodes
    .filter((node) => addedNodeIds.has(node.id))
    .map((n) => ({ id: String(n.id), label: n.data.label || '', type: n.data.type }));

  const removedNodesData: NodeDiff[] = compareSnapshotNodes
    .filter((node) => removedNodeIds.has(node.id))
    .map((n) => ({ id: String(n.id), label: n.data.label || '', type: n.data.type }));

  // ── Derived UI labels ────────────────────────────────────────────────────────
  const saveLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'failed' : 'save';
  const saveStatusLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'save failed' : hasUnsavedChanges ? 'unsaved changes' : 'up to date';
  const saveButtonClass = saveState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const flowDefaultTimeout = getFlowDefaultTimeoutMs(nodes);
  const leaveFlowEditor = async () => { const canLeave = await ensureSavedBeforeNavigation(); if (canLeave) { navigate('/flows'); return; } requestLeave({ kind: 'navigate', to: '/flows' }); };

  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const selectedMenuBranchFlows = sanitizeMenuBranchFlows(selectedConfig.submenu_branch_flows);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (compareVersion) {
    const compareBackAction = (
      <button className={styles.secondaryButton} onClick={() => { setCompareVersion(null); }} type="button">
        ← versions
      </button>
    );

    return (
      <PageLayout
        title={`v${flow?.versionNumber || 'current'} vs v${compareVersion.versionNum}`}
        subtitle="Version Comparison"
        backAction={compareBackAction}
      >
        <div className={styles.compareLayoutContent}>
          <div className={styles.compareSummarySection}>
            <FlowVersionDiffSummary
              addedNodes={addedNodesData}
              removedNodes={removedNodesData}
              changedNodes={changedNodesData}
              addedEdges={addedEdgeData}
              removedEdges={removedEdgeData}
            />
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      {editorNotice ? (
        <div className={`${styles.editorNotice} ${editorNoticeTone === 'success' ? styles.editorNoticeSuccess : styles.editorNoticeError}`}>
          {editorNotice}
        </div>
      ) : null}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button
            className={styles.secondaryButton}
            onClick={isSubflow
              ? () => void handleBreadcrumbNavigate(breadcrumb[breadcrumb.length - 2].flowId)
              : () => void leaveFlowEditor()}
            type="button"
          >
            {isSubflow ? '← back' : '← flows'}
          </button>
          <button className={styles.secondaryButton} onClick={() => triggerAutoLayoutWithTracking(rfInstance)} type="button">tidy layout</button>
          {canGroupSelection ? <button className={styles.secondaryButton} onClick={handleGroupSelectionWithTracking} type="button">group</button> : null}
          {canUngroupSelection ? <button className={styles.secondaryButton} onClick={handleUngroupSelectionWithTracking} type="button">ungroup</button> : null}
          {canRemoveFromGroupSelection ? <button className={styles.secondaryButton} onClick={() => void handleRemoveFromGroupWithTracking()} type="button">remove from group</button> : null}
        </div>
        <div className={styles.topBarCenter}>
          {isSubflow ? (
            // Breadcrumb trail lives in the toolbar when inside a subflow
            <nav className={styles.toolbarBreadcrumb} aria-label="Flow breadcrumb">
              {breadcrumb.map((item, index) => {
                const isLast = index === breadcrumb.length - 1;
                const branchContext = item.parentBranchKey
                  ? `${item.parentNodeLabel || item.parentNodeKey || 'Menu'} / ${item.parentBranchKey}`
                  : null;
                return (
                  <span className={styles.toolbarBreadcrumbItem} key={`${item.flowId}-${index}`}>
                    {isLast ? (
                      <span className={styles.toolbarBreadcrumbCurrent}>
                        {item.flowName}
                        {branchContext ? <span className={styles.toolbarBreadcrumbMeta}> · {branchContext}</span> : null}
                      </span>
                    ) : (
                      <button
                        className={styles.toolbarBreadcrumbLink}
                        onClick={() => void handleBreadcrumbNavigate(item.flowId)}
                        type="button"
                      >
                        {item.flowName}
                        {branchContext ? <span className={styles.toolbarBreadcrumbMeta}> · {branchContext}</span> : null}
                      </button>
                    )}
                    {!isLast ? <span className={styles.toolbarBreadcrumbSep}>/</span> : null}
                  </span>
                );
              })}
            </nav>
          ) : (
            <input
              className={styles.flowNameInput}
              value={flow?.name || 'loading…'}
              onChange={(event) => { if (flow) { userEditedRef.current = true; setFlow({ ...flow, name: event.target.value }); } }}
            />
          )}
        </div>
        <div className={styles.topBarRight}>
          {/* versions button — always rendered, disabled in subflow */}
          <button
            className={`${styles.secondaryButton} ${isSubflow ? styles.toolbarButtonDimmed : ''}`}
            disabled={isSubflow}
            onClick={() => setVersionsOpen((current) => !current)}
            type="button"
            title={isSubflow ? 'Versions are managed from the root flow' : 'Version history'}
          >
            versions
          </button>
          <button className={styles.secondaryButton} onClick={() => setSimulatorOpen((current) => !current)} type="button">simulate</button>
          {/* save button — always rendered, shows status in subflow */}
          <button
            className={`${saveButtonClass} ${isSubflow ? styles.toolbarButtonDimmed : ''}`}
            disabled={isSubflow}
            onClick={async () => { if (!isSubflow) { await saveFlow(); } }}
            type="button"
            title={isSubflow ? saveStatusLabel : undefined}
          >
            {isSubflow ? saveStatusLabel : saveLabel}
          </button>
        </div>
      </div>
      {timeoutWarningConfirmVisible && timeoutWarningMessage ? (
        <div className={styles.inlineSaveWarning}>
          <span>{timeoutWarningMessage}</span>
          <div className={styles.inlineSaveWarningActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setTimeoutWarningConfirmVisible(false);
                setTimeoutWarningMessage(null);
              }}
            >
              fix now
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={() => { void saveFlow(undefined, { allowTimeoutWarningBypass: true }); }}
            >
              save anyway
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.editorShell} style={editorShellStyle}>
        <section className={styles.leftPanel}>
          <div className={styles.paletteStickyTop}>
            <label className={styles.paletteSearchWrap}>
              <span className={styles.paletteSearchIcon} aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <circle cx="7" cy="7" r="4.5" />
                  <path d="M10.5 10.5L14 14" />
                </svg>
              </span>
              <input
                ref={paletteSearchRef}
                className={styles.paletteSearchInput}
                placeholder="search nodes..."
                value={paletteSearchQuery}
                onChange={(event) => setPaletteSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setPaletteSearchQuery('');
                  }
                }}
              />
            </label>
          </div>
          <div className={styles.paletteScrollArea}>
            {normalizedPaletteSearchQuery ? (
              <div className={styles.paletteList}>
                {paletteSearchMatches.map((item) => renderPaletteNodeCard(item))}
              </div>
            ) : (
              <div className={styles.paletteGroups}>
                {paletteGroups.map((group) => {
                  const isCollapsed = paletteGroupCollapsed[group.id] === true;
                  return (
                    <section className={styles.paletteGroup} key={group.id}>
                      <button
                        className={styles.paletteGroupToggle}
                        onClick={() => {
                          setPaletteGroupCollapsed((current) => ({
                            ...current,
                            [group.id]: !isCollapsed,
                          }));
                        }}
                        type="button"
                      >
                        <span className={`${styles.paletteGroupChevron} ${isCollapsed ? styles.paletteGroupChevronCollapsed : ''}`}>▼</span>
                        <span className={styles.paletteGroupLabel}>{group.label}</span>
                      </button>
                      {!isCollapsed ? (
                        <div className={styles.paletteList}>
                          {group.items.map((item) => renderPaletteNodeCard(item))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
            <FlowTreePanel
              tree={flowTree}
              currentFlowId={currentFlowId}
              onNavigate={handleBreadcrumbNavigate}
              onRename={handleRenameSubmenu}
            />
          </div>
        </section>

        <section ref={canvasPanelRef} className={styles.canvasPanel} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { userEditedRef.current = true; handleDrop(event, rfInstance); }}>
          {loadRefError ? <div className={styles.loadRefError}>{loadRefError}</div> : null}
          {flowLoadError ? (
            <div className={styles.flowLoadErrorState}>
              <p className={styles.flowLoadErrorMessage}>{flowLoadError}</p>
              <button
                className={styles.flowLoadRetryButton}
                type="button"
                onClick={() => {
                  setFlowLoadError(null);
                  setIsLoadingFlow(true);
                  // Re-trigger load by resetting initialized — the effect will re-run on currentFlowId
                  setIsInitialized(false);
                  void (async () => {
                    try {
                      const [response, breadcrumbResponse] = await Promise.all([getFlow(String(currentFlowId)), getFlowBreadcrumb(currentFlowId)]);
                      const nextRootFlowId = breadcrumbResponse.data[0]?.flowId ?? response.data.id;
                      setFlow(response.data); setBreadcrumb(breadcrumbResponse.data); setRootFlowId(nextRootFlowId);
                      const mappedNodes = mapFlowToNodes(response.data);
                      const nextNodes = decorateEditorNodes(mappedNodes, null);
                      const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, handleDeleteEdgeWithUserTracking);
                      setNodes(nextNodes); setEdges(nextEdges); setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
                      userEditedRef.current = false;
                      setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(null); setEditingGroupId(null); setIsInitialized(true);
                    } catch (retryError) {
                      setFlowLoadError(getApiError(retryError, 'failed to load flow'));
                    } finally {
                      setIsLoadingFlow(false);
                    }
                  })();
                }}
              >
                retry
              </button>
            </div>
          ) : null}
          <div className={styles.canvasWrapper}>
            {/* Empty canvas hint — visible only when just the start node exists */}
            {nodes.filter((n) => !String(n.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX) && n.type !== 'group').length <= 1 ? (
              <div className={styles.canvasHint} aria-hidden="true">
                Drag nodes from the palette to begin building your flow
              </div>
            ) : null}
            <ReactFlow
              fitView fitViewOptions={{ padding: 0.2 }}
              nodes={canvasNodes} edges={canvasEdges}
              onNodesChange={handleNodesChangeWithUserTracking} onEdgesChange={handleEdgesChangeWithUserTracking}
              onConnect={handleConnectWithUserTracking} onReconnect={handleReconnectWithUserTracking} onReconnectStart={onReconnectStart}
              isValidConnection={isValidConnection}
              onNodeDoubleClick={(_event, node) => { if (String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)) return; if (node.data.type === 'menu') void handleOpenSubmenu(node.id); }}
              onNodeDragStop={handleNodeDragStop} onEdgeClick={onEdgeClick}
              onSelectionChange={handleSelectionChange} multiSelectionKeyCode={['Meta', 'Control']}
              onPaneClick={handlePaneClick}
              onNodesDelete={(deletedNodes) => {
                const deletedIds = new Set(deletedNodes.filter((node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)).map((node) => node.id));
                deletedNodes.forEach((node) => {
                  if (node.data.type !== 'menu') {
                    return;
                  }
                  nodes.forEach((candidate) => {
                    if (String(candidate.data.config.groupId || '').trim() === node.id) {
                      deletedIds.add(candidate.id);
                    }
                  });
                });
                if (deletedIds.size === 0) return;
                userEditedRef.current = true;
                setEdges((current) => attachEdgeMetadata(current.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)), nodes, handleDeleteEdgeWithUserTracking));
                setNodes((current) => {
                  const groupIds = new Set(deletedNodes.filter((node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)).filter((node) => node.data.type === 'group').map((node) => node.id));
                  if (groupIds.size === 0) return current;
                  return decorateEditorNodes(current.flatMap((node) => { if (groupIds.has(node.id)) return []; if (node.parentId && groupIds.has(node.parentId)) return [removeNodeFromGroup(node, current)]; return [node]; }));
                });
              }}
              nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onInit={(instance) => { setRfInstance(instance); if (nodes.length > 0 && !fitDone.current) { fitDone.current = true; window.setTimeout(() => { void instance.fitView({ padding: 0.2, duration: 300 }); }, 100); } }}
              deleteKeyCode={null}
            >
              <Background variant={'dots' as never} color="var(--border-subtle)" gap={20} size={1.5} />
              <Controls position="bottom-left" />
              <button
                type="button"
                className={styles.minimapToggle}
                onClick={() => setMinimapVisible((v) => !v)}
                title={minimapVisible ? 'Hide mini-map' : 'Show mini-map'}
                aria-label={minimapVisible ? 'Hide mini-map' : 'Show mini-map'}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  {minimapVisible ? (
                    <>
                      <rect x="2" y="2" width="12" height="12" rx="2" />
                      <rect x="5" y="5" width="3" height="3" rx="0.5" />
                      <rect x="10" y="8" width="2" height="2" rx="0.5" />
                    </>
                  ) : (
                    <>
                      <rect x="2" y="2" width="12" height="12" rx="2" />
                      <line x1="5" y1="11" x2="11" y2="5" />
                    </>
                  )}
                </svg>
              </button>
              {minimapVisible ? (
                <MiniMap
                  className={styles.minimap}
                  nodeColor={minimapNodeColor}
                  maskColor="var(--overlay-strong)"
                  position="bottom-right"
                  {...miniMapSizeProps}
                  pannable
                  zoomable
                />
              ) : null}
            </ReactFlow>
          </div>
        </section>

        {showConfigPanel && canResizeConfigPanel ? (
          <div
            aria-hidden="true"
            className={styles.panelResizeHandle}
            onPointerDown={(event) => {
              event.preventDefault();
              configPanelResizeRef.current = { startX: event.clientX, startWidth: configPanelWidth };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        ) : null}

        {showConfigPanel ? (
          <section className={styles.rightPanel} style={canResizeConfigPanel ? { width: `${configPanelWidth}px` } : undefined}>
            <NodeConfigPanel
              selectedNode={selectedNode}
              selectedEdge={selectedEdge}
              selectedEdgeSourceNode={selectedEdgeSourceNode}
              audioItems={audioItems}
              nodes={nodes}
              edges={edges}
              onLabelChange={handleLabelChange}
              onConfigChange={handleConfigChange}
              onConfigValueChange={handleConfigValueChange}
              onConfigReplace={handleConfigReplace}
              onEdgeConditionChange={handleEdgeConditionChange}
              onMenuBranchToggle={handleMenuBranchToggle}
              onOpenSubmenuAction={handleOpenOrCreateSubmenu}
              onRenameSubmenu={handleRenameSubmenu}
              menuExtra={{ selectedMenuLocalEdgeBranches, selectedMenuBranchFlows }}
              flowDefaultTimeout={flowDefaultTimeout ?? QUEUE_LOGIN_TIMEOUT_DEFAULT_MS}
              queueItems={queueItems}
              extensions={extensions}
              operators={operators}
              contactNumbers={contactNumbers}
              trunks={trunks}
              saveAttempted={saveAttempted}
            />
          </section>
        ) : null}
      </div>


      {simulatorOpen ? (
        <FlowSimulator
          nodes={nodes}
          edges={edges}
          onClose={() => setSimulatorOpen(false)}
          onSubflowEnter={(flowId: number) => setCurrentFlowId(flowId)}
          onSubflowExit={() => setCurrentFlowId(rootFlowId)}
        />
      ) : null}

      <FlowVersionPanel
        versions={versions}
        currentVersionId={flow?.versionId ?? null}
        isOpen={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        onRestore={(versionId) => { const version = versions.find((v) => v.id === versionId) || null; if (version) { setPendingRestoreVersion(version); setRestoreConfirmOpen(true); } }}
        onCompare={(version) => void handleCompareVersion(version)}
        versionMessage={versionMessage}
        onVersionMessageChange={setVersionMessage}
        versionSaveState={versionSaveState}
        onCreateVersion={() => void handleCreateVersion()}
        versionNotice={versionNotice}
        versionsLoading={versionsLoading}
      />

      <ConfirmDialog open={confirmLeaveOpen} title="Unsaved changes" message="You have unsaved changes. Leave anyway?" confirmLabel="Leave" onConfirm={() => { const action = pendingLeaveActionRef.current; pendingLeaveActionRef.current = null; setConfirmLeaveOpen(false); if (action) performLeaveAction(action); }} onCancel={() => { pendingLeaveActionRef.current = null; setConfirmLeaveOpen(false); }} />
      <ConfirmDialog open={restoreConfirmOpen} title="Restore version" message="Restore this version? Current unsaved changes will be lost." confirmLabel="Restore" isLoading={isRestoring} onConfirm={() => void handleConfirmRestore()} onCancel={() => { if (!isRestoring) { setPendingRestoreVersion(null); setRestoreConfirmOpen(false); } }} />
    </div>
  );
}
