import { getApiError } from '../lib/apiError';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  updateFlow,
} from '../lib/api';
import type { BuilderNodeType, ContactNumber, ExtensionItem, FlowDetail, FlowNodeData, FlowVersionSummary, OperatorItem, QueueItem, SipTrunkItem } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { FlowBreadcrumb } from '../components/FlowBreadcrumb';
import { FlowTreePanel } from '../components/FlowTreePanel';
import { FlowCanvasEdge } from '../components/builder/FlowCanvasEdge';
import { FlowCanvasNode } from '../components/builder/FlowCanvasNode';
import { FlowGroupNode } from '../components/builder/FlowGroupNode';
import { HuntNode } from '../components/nodes/HuntNode';
import { MenuGroupNode } from '../components/nodes/MenuGroupNode';
import { NodeConfigPanel } from '../components/builder/NodeConfigPanel';
import { FlowVersionPanel } from '../components/builder/FlowVersionPanel';
import { FlowSimulator } from '../components/FlowSimulator/FlowSimulator';
import { useFlowData } from '../hooks/useFlowData';
import {
  attachEdgeMetadata,
  decorateNodes,
  menuRoutableBranchSet,
  removeNodeFromGroup,
  SUBFLOW_JUMP_NODE_ID_PREFIX,
  useFlowCanvas,
} from '../hooks/useFlowCanvas';
import styles from './FlowEditorPage.module.css';
import {
  applyAutoLayout,
  buildEditorSnapshot,
  buildSubflowJumpVisuals,
  createDraftFlow,
  createSavePayload,
  getFlowDefaultTimeoutMs,
  mapFlowToEdges,
  mapFlowToNodes,
  mapSnapshotToEdges,
  mapSnapshotToNodes,
  QUEUE_LOGIN_TIMEOUT_DEFAULT_MS,
  validateFlowBeforeSave,
  validateFlowTimeoutConfig,
  decorateDiffNodes,
  decorateDiffEdges,
  makeVersionEdgeKey,
  minimapNodeColor,
  renderPaletteIcon,
  palette,
  miniMapSizeProps,
} from './FlowEditorPage.helpers';

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
    types: ['menu', 'transfer', 'hunt', 'queue', 'queue_login'],
  },
  {
    id: 'caller-actions',
    label: 'CALLER ACTIONS',
    types: ['callback', 'voicemail', 'webhook'],
  },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
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
  | { kind: 'submenu'; nodeId: string };

// ─── Component ────────────────────────────────────────────────────────────────

export function FlowEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isDraftRoute = id === 'new';
  const initialRouteFlowId = Number(id || 0);

  // ── Canvas refs ──────────────────────────────────────────────────────────────
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const fitDone = useRef(false);
  const pendingLeaveActionRef = useRef<PendingLeaveAction | null>(null);
  const allowNextPopStateRef = useRef(false);
  const userEditedRef = useRef(false);

  // ── Hooks ────────────────────────────────────────────────────────────────────
  const flowData = useFlowData(isDraftRoute);
  const canvas = useFlowCanvas();
  const { flow, setFlow, audioItems, breadcrumb, setBreadcrumb, flowTree, setFlowTree, treeRefreshKey, incrementTreeRefreshKey, versions, setVersions, versionsLoading, loadVersions, loadFlowTree, restoreVersion, loadBreadcrumb, loadVersionDetail } = flowData;
  const { nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, selectedNode, selectedEdge, selectedEdgeSourceNode, selectedGroupNode, canGroupSelection, canUngroupSelection, canRemoveFromGroupSelection, selectedChildNode, groupableSelection, decorateEditorNodes, deleteNode, deleteEdge, onConnect, onEdgeClick, onReconnect, onReconnectStart, handleNodeDragStop, handleSelectionChange, handleDragStart, handleDrop, handleGroupSelection, handleUngroupSelection, handleRemoveFromGroup, handlePaneClick, triggerAutoLayout, setHandleOpenSubmenuCallback, selectedNodeId, setSelectedNodeId, selectedNodeIds, setSelectedNodeIds, selectedEdgeId, setSelectedEdgeId, editingGroupId, setEditingGroupId } = canvas;

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
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionMessage, setVersionMessage] = useState('');
  const [versionSaveState, setVersionSaveState] = useState<'idle' | 'saving'>('idle');
  const [versionNotice, setVersionNotice] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<FlowVersionSummary | null>(null);
  const [compareVersion, setCompareVersion] = useState<import('../types').FlowVersionDetail | null>(null);
  const [currentVersionDetail, setCurrentVersionDetail] = useState<import('../types').FlowVersionDetail | null>(null);
  const [submenuNodeOptionsLoading, setSubmenuNodeOptionsLoading] = useState(false);
  const [submenuStartNodeKey, setSubmenuStartNodeKey] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [contactNumbers, setContactNumbers] = useState<ContactNumber[]>([]);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [timeoutWarningConfirmVisible, setTimeoutWarningConfirmVisible] = useState(false);
  const [timeoutWarningMessage, setTimeoutWarningMessage] = useState<string | null>(null);
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
  const showEditorNotice = (msg: string | null) => {
    setEditorNotice(msg);
    if (editorNoticeTimerRef.current) clearTimeout(editorNoticeTimerRef.current);
    if (msg) editorNoticeTimerRef.current = setTimeout(() => setEditorNotice(null), 6000);
  };
  useEffect(() => () => { if (editorNoticeTimerRef.current) clearTimeout(editorNoticeTimerRef.current); }, []);
  useEffect(() => () => { if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current); if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); }, []);
  useEffect(() => {
    paletteSearchRef.current?.focus();
  }, []);

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
      if (queuesRes.status === 'fulfilled') {
        setQueueItems(queuesRes.value.data);
      }
      if (extensionsRes.status === 'fulfilled') {
        setExtensions(extensionsRes.value.data);
      }
      if (operatorsRes.status === 'fulfilled') {
        setOperators(operatorsRes.value.data);
      }
      if (contactsRes.status === 'fulfilled') {
        setContactNumbers(contactsRes.value.data);
      }
      if (trunksRes.status === 'fulfilled') {
        setTrunks(trunksRes.value.data);
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

  // ── Submenu options for selected menu node ──────────────────────────────────
  useEffect(() => {
    const selectedMenuNode = nodes.find((node) => node.id === selectedNodeId && node.data.type === 'menu') || null;
    if (!selectedMenuNode) { setSubmenuNodeOptionsLoading(false); setSubmenuStartNodeKey(null); return; }
    const subflowId = Number(selectedMenuNode.data.subflowId || 0);
    if (subflowId <= 0) { setSubmenuNodeOptionsLoading(false); setSubmenuStartNodeKey(null); return; }
    let active = true;
    setSubmenuNodeOptionsLoading(true);
    getFlow(String(subflowId)).then((response) => {
      if (!active) return;
      const defaultStart = response.data.nodes.find((item) => item.type === 'start')?.nodeKey || response.data.nodes.find((item) => item.type !== 'group')?.nodeKey || null;
      setSubmenuStartNodeKey(defaultStart);
    }).catch(() => { if (active) setSubmenuStartNodeKey(null); }).finally(() => { if (active) setSubmenuNodeOptionsLoading(false); });
    return () => { active = false; };
  }, [selectedNodeId]);

  // ── Auto-assign submenu branch targets ──────────────────────────────────────
  useEffect(() => {
    if (!selectedNodeId) return;
    const selectedMenuNode = nodes.find((node) => node.id === selectedNodeId && node.data.type === 'menu') || null;
    if (!selectedMenuNode) return;
    const localEdgeBranches = new Set(edges.filter((edge) => edge.source === selectedMenuNode.id).map((edge) => {
      const resolved = String(edge.data?.condition || edge.data?.branchKey || '').trim();
      return menuRoutableBranchSet.has(resolved) ? resolved : null;
    }).filter((value): value is string => Boolean(value)));
    setNodes((current) => {
      const currentNode = current.find((node) => node.id === selectedMenuNode.id && node.data.type === 'menu');
      if (!currentNode) return current;
      const configuredBranches = (Array.isArray(currentNode.data.config.branches) ? currentNode.data.config.branches as string[] : ['1', '2']).filter((b) => menuRoutableBranchSet.has(String(b)));
      const currentTargets = { ...(typeof currentNode.data.config.submenu_branch_targets === 'object' && currentNode.data.config.submenu_branch_targets ? currentNode.data.config.submenu_branch_targets as Record<string, string> : {}) };
      const nextTargets = { ...currentTargets };
      let changed = false;
      for (const branch of Object.keys(nextTargets)) { if (localEdgeBranches.has(branch)) { delete nextTargets[branch]; changed = true; } }
      if (submenuStartNodeKey) {
        for (const branch of configuredBranches) {
          if (localEdgeBranches.has(branch)) continue;
          // Only update if the branch already had a submenu target assigned
          // Never auto-assign a branch that has no existing target
          if (!currentTargets[branch]) continue;
          if (nextTargets[branch] === submenuStartNodeKey) continue;
          nextTargets[branch] = submenuStartNodeKey;
          changed = true;
        }
      }
      if (!changed) return current;
      return decorateEditorNodes(current.map((node) => node.id === currentNode.id ? { ...node, data: { ...node.data, config: { ...node.data.config, submenu_branch_targets: nextTargets } } } : node));
    });
  }, [edges, nodes, selectedNodeId, submenuStartNodeKey, setNodes, decorateEditorNodes]);

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
  const handleOpenSubmenu = useCallback(async (nodeId: string) => {
    if (isDraft || currentFlowId <= 0) { showEditorNotice('Save this flow before opening a submenu.'); return; }
    const canLeave = await ensureSavedBeforeNavigation();
    if (!canLeave) {
      requestLeave({ kind: 'submenu', nodeId });
      return;
    }
    try {
      const response = await getFlow(String(currentFlowId));
      const menuNode = response.data.nodes.find((node) => node.nodeKey === nodeId);
      const subflowId = Number(menuNode?.subflowId || 0);
      if (!subflowId) { showEditorNotice('Menu subflow is missing. Save the flow and try again.'); return; }
      showEditorNotice(null);
      setBreadcrumb((current) => {
        const currentLabel = flow?.name || response.data.name;
        const existingIndex = current.findIndex((item) => item.flowId === currentFlowId);
        const base = existingIndex >= 0 ? current.slice(0, existingIndex + 1) : [...current, { flowId: currentFlowId, flowName: currentLabel }];
        return [...base, { flowId: subflowId, flowName: menuNode?.label || 'Menu' }];
      });
      setCurrentFlowId(subflowId);
    } catch { showEditorNotice('Failed to open submenu.'); }
  }, [currentFlowId, flow?.name, isDraft, setBreadcrumb]);

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
    let active = true;
    const load = async () => {
      if (isDraftRoute) {
        const draftFlow = createDraftFlow();
        const draftNodes = decorateEditorNodes([{ id: 'start', type: 'flowNode', position: { x: 120, y: 140 }, data: { label: 'Start', type: 'start', config: {}, subflowId: null }, draggable: false }], null);
        if (!active) return;
        setFlow(draftFlow); setBreadcrumb([]); setNodes(draftNodes); setEdges([]); setSavedSnapshot(null);
        userEditedRef.current = false;
        setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(null); setEditingGroupId(null); setIsInitialized(true); return;
      }
      if (currentFlowId <= 0) return;
      const [response, breadcrumbResponse] = await Promise.all([getFlow(String(currentFlowId)), getFlowBreadcrumb(currentFlowId)]);
      if (!active) return;
      setFlow(response.data); setBreadcrumb(breadcrumbResponse.data);
      const panelWidth = canvasPanelRef.current?.clientWidth || 900;
      const mappedNodes = mapFlowToNodes(response.data);
      const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
      const nextNodes = decorateEditorNodes(arrangedNodes, null);
      const nextEdges = attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, handleDeleteEdgeWithUserTracking);
      setNodes(nextNodes); setEdges(nextEdges); setSavedSnapshot(buildEditorSnapshot(response.data, nextNodes, nextEdges));
      userEditedRef.current = false;
      setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(null); setEditingGroupId(null); setIsInitialized(true);
    };
    void load();
    return () => { active = false; };
  }, [currentFlowId, isDraftRoute]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const renderPaletteNodeCard = useCallback((item: (typeof palette)[number]) => (
    <div className={styles.paletteItem} draggable={item.type !== 'start'} key={item.type} onDragStart={() => handleDragStart(item.type)} title={item.type === 'start' ? 'Seed flows already contain the required start node' : 'Drag onto canvas'}>
      <span className={`${styles.paletteBar} ${styles[`bar${item.type.replace('_', '')}`]}`} />
      {renderPaletteIcon(item.type)}
      <div>
        <div className={styles.paletteType}>{item.type}</div>
        <div className={styles.paletteLabel}>{item.label}</div>
      </div>
    </div>
  ), [handleDragStart]);

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
      void handleOpenSubmenu(action.nodeId);
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
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (selectedEdgeId) { event.preventDefault(); userEditedRef.current = true; deleteEdge(selectedEdgeId); return; }
      if (selectedNodeIds.length === 1 && selectedGroupNode) { event.preventDefault(); handleUngroupSelectionWithTracking(); return; }
      if (selectedNodeIds.length === 0) return;
      event.preventDefault();
      userEditedRef.current = true;
      for (const nodeId of selectedNodeIds) deleteNode(nodeId);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteEdge, deleteNode, handleUngroupSelectionWithTracking, selectedEdgeId, selectedGroupNode, selectedNodeIds]);

  const saveFlow = async (versionMessage?: string, options?: { auto?: boolean; allowTimeoutWarningBypass?: boolean }): Promise<FlowDetail | null> => {
    if (!flow) return null;
    if (saveInFlightRef.current) return null;
    if (!options?.auto) setSaveAttempted(true);
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
    const validationError = await validateFlowBeforeSave(nodes, edges);
    if (validationError) { if (!options?.auto) { setSaveState('failed'); showEditorNotice(validationError); } return null; }
    saveInFlightRef.current = true; setSaveState('saving');
    try {
      const payload = createSavePayload(flow, nodes, edges, versionMessage);
      const response = isDraft ? await createFlow(payload) : await updateFlow(String(currentFlowId), payload);
      setFlow(response.data);
      if (isDraft) setRootFlowId(response.data.id);
      setCurrentFlowId(response.data.id); setIsDraft(false);
      const shouldRefreshCanvasFromServer = !options?.auto || isDraft;
      if (shouldRefreshCanvasFromServer) {
        const panelWidth = canvasPanelRef.current?.clientWidth || 900;
        const mappedNodes = mapFlowToNodes(response.data);
        const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
        const nextNodes = decorateEditorNodes(arrangedNodes, null);
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
        setVersions(refreshedVersions.data); setBreadcrumb(breadcrumbResponse.data); incrementTreeRefreshKey();
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

  // ── Subflow auto-save disabled ───────────────────────────────────────────────
  // Subflow edits should remain local until explicit save from the main flow.
  // Main flow changes auto-save with debounce to avoid excessive API calls.
  useEffect(() => {
    if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current);
    if (!hasUnsavedChanges || !isInitialized || !flow || isSubflow) {
      return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
    }
    autoSaveTimer.current = window.setTimeout(() => {
      void saveFlow(undefined, { auto: true });
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => { if (autoSaveTimer.current) window.clearTimeout(autoSaveTimer.current); };
  }, [hasUnsavedChanges, isInitialized, flow, isSubflow, versionSaveState, saveState, confirmLeaveOpen, compareVersion]);

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
    const currentBranches = (Array.isArray(selectedConfig.branches) ? selectedConfig.branches as string[] : ['1', '2']).filter((b) => menuRoutableBranchSet.has(String(b)));
    const nextBranches = checked ? Array.from(new Set([...currentBranches, branch])) : currentBranches.filter((value) => value !== branch);
    handleConfigValueChange('branches', nextBranches);
    if (!checked) {
      const currentTargets = { ...(typeof selectedConfig.submenu_branch_targets === 'object' && selectedConfig.submenu_branch_targets ? selectedConfig.submenu_branch_targets as Record<string, string> : {}) };
      if (currentTargets[branch]) { delete currentTargets[branch]; handleConfigValueChange('submenu_branch_targets', currentTargets); }
    }
  };
  const handleMenuSubflowTargetChange = (branch: string, targetNodeKey: string | null) => {
    const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
    const currentTargets = { ...(typeof selectedConfig.submenu_branch_targets === 'object' && selectedConfig.submenu_branch_targets ? selectedConfig.submenu_branch_targets as Record<string, string> : {}) };
    if (targetNodeKey) { currentTargets[branch] = targetNodeKey; } else { delete currentTargets[branch]; }
    handleConfigValueChange('submenu_branch_targets', currentTargets);
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
    userEditedRef.current = true;
    setEdges((current) => attachEdgeMetadata(current.map((edge) => edge.id !== selectedEdgeId ? edge : { ...edge, data: { branchKey: value || 'default', condition: value, sourceNodeType: String(edge.data?.sourceNodeType || nodes.find((node) => node.id === edge.source)?.data.type || 'hangup'), onDelete: () => handleDeleteEdgeWithUserTracking(edge.id) } }), nodes, handleDeleteEdgeWithUserTracking));
  };

  const selectedMenuLocalEdgeBranches = useMemo(
    () => new Set(edges.filter((edge) => edge.source === selectedNodeId).map((edge) => { const resolved = String(edge.data?.condition || edge.data?.branchKey || '').trim(); return menuRoutableBranchSet.has(resolved) ? resolved : null; }).filter((value): value is string => Boolean(value))),
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
    const trimmed = versionMessage.trim();
    if (!trimmed) return;
    setVersionSaveState('saving'); setVersionNotice(null);
    let activeFlow = flow;
    if (hasUnsavedChanges) {
      const saved = await saveFlow(trimmed);
      if (!saved) { setVersionSaveState('idle'); return; }
      activeFlow = saved; setVersionMessage(''); setVersionNotice('Flow saved and version committed.'); setVersionSaveState('idle'); return;
    }
    await createFlowVersion(activeFlow.id, trimmed);
    setVersionMessage(''); setVersionNotice('Version committed.');
    const refreshed = await listFlowVersions(activeFlow.id);
    setVersions(refreshed.data); setVersionSaveState('idle');
  };
  const handleConfirmRestore = async () => {
    if (!pendingRestoreVersion || !flow) return;
    const restored = await flowData.restoreVersion(flow.id, pendingRestoreVersion.id);
    if (!restored) return;
    const breadcrumbResponse = await flowData.loadBreadcrumb(flow.id);
    setFlow(restored); setBreadcrumb(breadcrumbResponse); incrementTreeRefreshKey(); setIsDraft(false);
    const panelWidth = canvasPanelRef.current?.clientWidth || 900;
    const nextNodes = decorateEditorNodes(applyAutoLayout(mapFlowToNodes(restored), panelWidth), null);
    const nextEdges = attachEdgeMetadata(mapFlowToEdges(restored), nextNodes, handleDeleteEdgeWithUserTracking);
    setNodes(nextNodes); setEdges(nextEdges); setSavedSnapshot(buildEditorSnapshot(restored, nextNodes, nextEdges));
    userEditedRef.current = false;
    setSelectedNodeId(null); setSelectedNodeIds([]); setSelectedEdgeId(null); setEditingGroupId(null);
    setPendingRestoreVersion(null); setRestoreConfirmOpen(false);
  };
  const handleCompareVersion = async (version: FlowVersionSummary) => {
    if (!flow) return;
    const detail = await flowData.loadVersionDetail(flow.id, version.id);
    if (detail) setCompareVersion(detail);
  };

  // ── Canvas visuals ──────────────────────────────────────────────────────────
  const { canvasNodes, canvasEdges } = useMemo(() => {
    const visuals = buildSubflowJumpVisuals(nodes, edges);
    return { canvasNodes: [...nodes, ...visuals.nodes], canvasEdges: [...edges, ...visuals.edges] };
  }, [edges, nodes]);

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
  const currentEdgeKeys = new Set(currentSnapshotEdges.map((edge) => makeVersionEdgeKey(edge)));
  const snapshotEdgeKeys = new Set(compareSnapshotEdges.map((edge) => makeVersionEdgeKey(edge)));
  const changedEdgeKeys = new Set([...Array.from(currentEdgeKeys).filter((key) => !snapshotEdgeKeys.has(key)), ...Array.from(snapshotEdgeKeys).filter((key) => !currentEdgeKeys.has(key))]);
  const currentDiffNodes = decorateDiffNodes(currentSnapshotNodes.map((node) => ({ ...node, selected: false })), addedNodeIds, '--accent');
  const versionDiffNodes = decorateDiffNodes(compareSnapshotNodes.map((node) => ({ ...node, selected: false })), removedNodeIds, '--color-error');
  const currentDiffEdges = decorateDiffEdges(currentSnapshotEdges.map((edge) => ({ ...edge, selected: false })), changedEdgeKeys);
  const versionDiffEdges = decorateDiffEdges(compareSnapshotEdges.map((edge) => ({ ...edge, selected: false })), changedEdgeKeys);
  const addedNodeLabels = currentSnapshotNodes.filter((node) => addedNodeIds.has(node.id)).map((node) => node.data.type);
  const removedNodeLabels = compareSnapshotNodes.filter((node) => removedNodeIds.has(node.id)).map((node) => node.data.type);
  const changedEdgeLabels = Array.from(changedEdgeKeys).map((key) => { const [source, target] = key.split('|'); return `${source}→${target}`; });

  // ── Derived UI labels ────────────────────────────────────────────────────────
  const saveLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'failed' : 'save';
  const saveStatusLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'save failed' : hasUnsavedChanges ? 'unsaved changes' : 'up to date';
  const saveButtonClass = saveState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const flowDefaultTimeout = getFlowDefaultTimeoutMs(nodes);
  const leaveFlowEditor = async () => { const canLeave = await ensureSavedBeforeNavigation(); if (canLeave) { navigate('/flows'); return; } requestLeave({ kind: 'navigate', to: '/flows' }); };

  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const selectedMenuSubmenuTargets = typeof selectedConfig.submenu_branch_targets === 'object' && selectedConfig.submenu_branch_targets ? selectedConfig.submenu_branch_targets as Record<string, string> : {};

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {editorNotice ? <div className={styles.editorNotice}>{editorNotice}</div> : null}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button className={styles.secondaryButton} onClick={isSubflow ? () => void handleBreadcrumbNavigate(breadcrumb[breadcrumb.length - 2].flowId) : () => void leaveFlowEditor()} type="button">
            {isSubflow ? '← back to parent' : 'back'}
          </button>
          <button className={styles.secondaryButton} onClick={() => triggerAutoLayoutWithTracking(rfInstance)} type="button">tidy layout</button>
          {canGroupSelection ? <button className={styles.secondaryButton} onClick={handleGroupSelectionWithTracking} type="button">group</button> : null}
          {canUngroupSelection ? <button className={styles.secondaryButton} onClick={handleUngroupSelectionWithTracking} type="button">ungroup</button> : null}
          {canRemoveFromGroupSelection ? <button className={styles.secondaryButton} onClick={() => void handleRemoveFromGroupWithTracking()} type="button">remove from group</button> : null}
          <input className={styles.flowNameInput} value={flow?.name || 'loading…'} onChange={(event) => { if (flow) { userEditedRef.current = true; setFlow({ ...flow, name: event.target.value }); } }} />
        </div>
        <div className={styles.topBarRight}>
          {!isSubflow ? <button className={styles.secondaryButton} onClick={() => setVersionsOpen((current) => !current)} type="button">versions</button> : null}
          <button className={styles.secondaryButton} onClick={() => setSimulatorOpen((current) => !current)} type="button">simulate</button>
          {!isSubflow ? <button className={saveButtonClass} onClick={async () => { const saved = await saveFlow(); if (saved) await createFlowVersion(saved.id, 'Saved from editor'); }} type="button">{saveLabel}</button> : <span className={styles.saveStatus}>{saveStatusLabel}</span>}
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

      <div className={styles.editorShell}>
        <section className={styles.leftPanel}>
          <div className={styles.panelTitle}>node palette</div>
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
                      <span className={styles.paletteGroupChevron}>{isCollapsed ? '▶' : '▼'}</span>
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
          <FlowTreePanel tree={flowTree} currentFlowId={currentFlowId} onNavigate={handleBreadcrumbNavigate} />
        </section>

        <section ref={canvasPanelRef} className={styles.canvasPanel} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { userEditedRef.current = true; handleDrop(event, rfInstance); }}>
          <FlowBreadcrumb items={breadcrumb} onNavigate={handleBreadcrumbNavigate} />
          <div className={styles.canvasWrapper}>
            <ReactFlow
              fitView fitViewOptions={{ padding: 0.2 }}
              nodes={canvasNodes} edges={canvasEdges}
              onNodesChange={handleNodesChangeWithUserTracking} onEdgesChange={handleEdgesChangeWithUserTracking}
              onConnect={handleConnectWithUserTracking} onReconnect={handleReconnectWithUserTracking} onReconnectStart={onReconnectStart}
              onNodeDoubleClick={(_event, node) => { if (String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)) return; if (node.data.type === 'menu') void handleOpenSubmenu(node.id); }}
              onNodeDragStop={handleNodeDragStop} onEdgeClick={onEdgeClick}
              onSelectionChange={handleSelectionChange} multiSelectionKeyCode="Shift"
              onPaneClick={handlePaneClick}
              onNodesDelete={(deletedNodes) => {
                const deletedIds = new Set(deletedNodes.filter((node) => !String(node.id).startsWith(SUBFLOW_JUMP_NODE_ID_PREFIX)).map((node) => node.id));
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
              <Background color="var(--border-subtle)" gap={24} />
              <Controls position="bottom-left" />
              <MiniMap nodeColor={minimapNodeColor} maskColor="var(--overlay-strong)" position="bottom-right" {...miniMapSizeProps} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', borderRadius: '6px', width: 160, height: 120 }} pannable zoomable />
            </ReactFlow>
          </div>
        </section>

        <section className={styles.rightPanel}>
          <NodeConfigPanel
            selectedNode={selectedNode}
            selectedEdge={selectedEdge}
            selectedEdgeSourceNode={selectedEdgeSourceNode}
            audioItems={audioItems}
            nodes={nodes}
            onLabelChange={handleLabelChange}
            onConfigChange={handleConfigChange}
            onConfigValueChange={handleConfigValueChange}
            onConfigReplace={handleConfigReplace}
            onEdgeConditionChange={handleEdgeConditionChange}
            onMenuBranchToggle={handleMenuBranchToggle}
            onMenuSubflowTargetChange={handleMenuSubflowTargetChange}
            menuExtra={{ submenuNodeOptionsLoading, submenuStartNodeKey, selectedMenuLocalEdgeBranches, selectedMenuSubmenuTargets }}
            flowDefaultTimeout={flowDefaultTimeout ?? QUEUE_LOGIN_TIMEOUT_DEFAULT_MS}
            queueItems={queueItems}
            extensions={extensions}
            operators={operators}
            contactNumbers={contactNumbers}
            trunks={trunks}
            saveAttempted={saveAttempted}
          />
        </section>
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

      <ConfirmDialog open={confirmLeaveOpen} title="Unsaved changes" message="You have unsaved changes. Leave anyway?" confirmLabel="Leave" onConfirm={() => { const action = pendingLeaveActionRef.current; pendingLeaveActionRef.current = null; setConfirmLeaveOpen(false); if (action) performLeaveAction(action); }} onCancel={() => { pendingLeaveActionRef.current = null; setConfirmLeaveOpen(false); }} />
      <ConfirmDialog open={restoreConfirmOpen} title="Restore version" message="Restore this version? Current unsaved changes will be lost." confirmLabel="Restore" onConfirm={() => void handleConfirmRestore()} onCancel={() => { setPendingRestoreVersion(null); setRestoreConfirmOpen(false); }} />
    </div>
  );
}
