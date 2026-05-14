import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Edge, Node } from 'reactflow';
import type { FlowDetail, FlowNodeData } from '../types';
import { FlowEditorPage } from './FlowEditorPage';
import styles from './FlowEditorPage.module.css';
import * as api from '../lib/api';

const flowCanvasMock = vi.hoisted(() => ({
  useFlowCanvas: vi.fn(),
}));

vi.mock('../hooks/useFlowCanvas', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useFlowCanvas')>('../hooks/useFlowCanvas');
  return {
    ...actual,
    useFlowCanvas: flowCanvasMock.useFlowCanvas,
  };
});

vi.mock('../lib/api', () => ({
  getFlow: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', nodes: [], edges: [] } })),
  getFlowBreadcrumb: vi.fn(() => Promise.resolve({ data: [] })),
  getFlowTree: vi.fn(() => Promise.resolve({ data: { id: 1, name: 'Test Flow', children: [] } })),
  createFlow: vi.fn(),
  updateFlow: vi.fn(),
  listAudioVoices: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listAudio: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
  listQueues: vi.fn(() => Promise.resolve({ data: [] })),
  listExtensions: vi.fn(() => Promise.resolve({
    data: [{ id: 11, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: '2024-01-01' }],
    total: 1,
  })),
  listOperators: vi.fn(() => Promise.resolve({
    data: [{ id: 21, name: 'Main Operator', status: 'online', extension: undefined, contactNumber: { number: '+94770000000' }, hasPIN: true, createdAt: '2024-01-01' }],
    total: 1,
  })),
  getContactNumbers: vi.fn(() => Promise.resolve({ data: [] })),
  listTrunks: vi.fn(() => Promise.resolve({ data: [] })),
  listFlowVersions: vi.fn(() => Promise.resolve({ data: [] })),
}));

vi.mock('../lib/socket', () => ({
  diagnosticsSocket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

const buildNode = (overrides?: Partial<Node<FlowNodeData>>): Node<FlowNodeData> => ({
  id: 'node-1',
  type: 'flowNode',
  position: { x: 0, y: 0 },
  data: {
    type: 'transfer',
    label: 'Selected node',
    config: { target_type: 'extension', target_value: '2001', timeout_ms: 30000 },
  } as FlowNodeData,
  ...overrides,
});

const buildEdge = (overrides?: Partial<Edge>): Edge => ({
  id: 'edge-1',
  source: 'menu-1',
  target: 'node-1',
  data: { branchKey: '1', condition: '1', sourceNodeType: 'menu' },
  ...overrides,
});

const buildCanvasState = ({
  nodes = [],
  edges = [],
  selectedNode = null,
  selectedEdge = null,
  selectedEdgeSourceNode = null,
}: {
  nodes?: Array<Node<FlowNodeData>>;
  edges?: Array<Edge>;
  selectedNode?: Node<FlowNodeData> | null;
  selectedEdge?: Edge | null;
  selectedEdgeSourceNode?: Node<FlowNodeData> | null;
} = {}) => ({
  nodes,
  edges,
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  onNodesChange: vi.fn(),
  onEdgesChange: vi.fn(),
  selectedNodeId: selectedNode?.id ?? null,
  setSelectedNodeId: vi.fn(),
  selectedNodeIds: selectedNode ? [selectedNode.id] : [],
  setSelectedNodeIds: vi.fn(),
  selectedEdgeId: selectedEdge?.id ?? null,
  setSelectedEdgeId: vi.fn(),
  editingGroupId: null,
  setEditingGroupId: vi.fn(),
  selectedNode,
  selectedEdge,
  selectedEdgeSourceNode,
  selectedGroupNode: null,
  canGroupSelection: false,
  canUngroupSelection: false,
  canRemoveFromGroupSelection: false,
  selectedChildNode: null,
  groupableSelection: [],
  decorateEditorNodes: vi.fn((items: Array<Node<FlowNodeData>>) => items),
  deleteNode: vi.fn(),
  deleteEdge: vi.fn(),
  onConnect: vi.fn(),
  isValidConnection: vi.fn(() => true),
  onEdgeClick: vi.fn(),
  onReconnect: vi.fn(),
  onReconnectStart: vi.fn(),
  handleNodeDragStop: vi.fn(),
  handleSelectionChange: vi.fn(),
  handleDragStart: vi.fn(),
  handleDrop: vi.fn(),
  handleGroupSelection: vi.fn(),
  handleUngroupSelection: vi.fn(),
  handleRemoveFromGroup: vi.fn(),
  handlePaneClick: vi.fn(),
  triggerAutoLayout: vi.fn(),
  handleOpenSubmenuCallback: null,
  setHandleOpenSubmenuCallback: vi.fn(),
});

let currentCanvasState = buildCanvasState();

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

function buildFlowDetail(overrides?: Partial<FlowDetail>): FlowDetail {
  return {
    id: 1,
    name: 'Test Flow',
    description: '',
    slug: 'test-flow',
    parentFlowId: null,
    parentNodeKey: null,
    parentBranchKey: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    versionId: 10,
    versionNumber: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

function renderFlowEditor(initialEntry = '/flows/1') {
  const router = createMemoryRouter(
    [{ path: '/flows/:id', element: <FlowEditorPage /> }],
    {
      initialEntries: [initialEntry],
      future: { v7_relativeSplatPath: true },
    },
  );

  return {
    router,
    ...render(
      <RouterProvider
        router={router}
        future={{ v7_startTransition: true }}
      />,
    ),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FlowEditorPage config panel visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setWindowWidth(1440);
    currentCanvasState = buildCanvasState();
    flowCanvasMock.useFlowCanvas.mockImplementation(() => currentCanvasState);
  });

  it('hides the config panel with no selection, shows it for a node selection, and hides it again when selection clears', async () => {
    const node = buildNode();
    currentCanvasState = buildCanvasState({ nodes: [node] });

    const initialView = renderFlowEditor();

    await waitFor(() => expect(api.listExtensions).toHaveBeenCalled());

    const editorShell = initialView.container.querySelector(`.${styles.editorShell}`);
    expect(editorShell).not.toBeNull();
    expect(editorShell).toHaveStyle({ gridTemplateColumns: '220px minmax(0, 1fr)' });
    expect(initialView.container.querySelector(`.${styles.rightPanel}`)).not.toBeInTheDocument();
    expect(initialView.container.querySelector(`.${styles.panelResizeHandle}`)).not.toBeInTheDocument();
    expect(screen.queryByText('Select a node to configure it')).not.toBeInTheDocument();

    initialView.unmount();
    currentCanvasState = buildCanvasState({ nodes: [node], selectedNode: node });
    const selectedView = renderFlowEditor();

    expect(await screen.findByText('node key: node-1')).toBeInTheDocument();
    expect(selectedView.container.querySelector(`.${styles.editorShell}`)).toHaveStyle({
      gridTemplateColumns: '220px minmax(0, 1fr) 10px 320px',
    });
    expect(selectedView.container.querySelector(`.${styles.rightPanel}`)).toHaveStyle({ width: '320px' });
    expect(selectedView.container.querySelector(`.${styles.panelResizeHandle}`)).toBeInTheDocument();

    selectedView.unmount();
    currentCanvasState = buildCanvasState({ nodes: [node] });
    const clearedView = renderFlowEditor();

    await waitFor(() => {
      expect(screen.queryByText('node key: node-1')).not.toBeInTheDocument();
      expect(clearedView.container.querySelector(`.${styles.editorShell}`)).toHaveStyle({
        gridTemplateColumns: '220px minmax(0, 1fr)',
      });
      expect(clearedView.container.querySelector(`.${styles.rightPanel}`)).not.toBeInTheDocument();
      expect(clearedView.container.querySelector(`.${styles.panelResizeHandle}`)).not.toBeInTheDocument();
    });
  });

  it('renders edge config at the new default width when an edge is selected', async () => {
    const edgeSourceNode = buildNode({
      id: 'menu-1',
      data: {
        type: 'menu',
        label: 'Main menu',
        config: { branches: ['1'] },
      } as FlowNodeData,
    });
    const node = buildNode();
    const edge = buildEdge();
    currentCanvasState = buildCanvasState({
      nodes: [edgeSourceNode, node],
      edges: [edge],
      selectedEdge: edge,
      selectedEdgeSourceNode: edgeSourceNode,
    });

    const view = renderFlowEditor();

    await waitFor(() => expect(api.listExtensions).toHaveBeenCalled());

    expect(await screen.findByText('edge config')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(view.container.querySelector(`.${styles.editorShell}`)).toHaveStyle({
      gridTemplateColumns: '220px minmax(0, 1fr) 10px 320px',
    });
    expect(view.container.querySelector(`.${styles.rightPanel}`)).toHaveStyle({ width: '320px' });
  });

  it('restores a saved config panel width instead of using the new default', async () => {
    const node = buildNode();
    window.localStorage.setItem('callytics_flow_config_panel_width', '440');
    currentCanvasState = buildCanvasState({ nodes: [node], selectedNode: node });

    const view = renderFlowEditor();

    await waitFor(() => expect(api.listExtensions).toHaveBeenCalled());

    expect(await screen.findByText('node key: node-1')).toBeInTheDocument();
    expect(view.container.querySelector(`.${styles.editorShell}`)).toHaveStyle({
      gridTemplateColumns: '220px minmax(0, 1fr) 10px 440px',
    });
    expect(view.container.querySelector(`.${styles.rightPanel}`)).toHaveStyle({ width: '440px' });
  });
});

describe('FlowEditorPage start-node protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setWindowWidth(1440);
    currentCanvasState = buildCanvasState();
    flowCanvasMock.useFlowCanvas.mockImplementation(() => currentCanvasState);
  });

  it('ignores Delete and Backspace when only the start node is selected', async () => {
    const startNode = buildNode({
      id: 'start',
      data: {
        type: 'start',
        label: 'Start',
        config: {},
      } as FlowNodeData,
    });

    currentCanvasState = buildCanvasState({
      nodes: [startNode],
      selectedNode: startNode,
    });
    flowCanvasMock.useFlowCanvas.mockImplementation(() => currentCanvasState);

    renderFlowEditor();

    await waitFor(() => expect(api.listExtensions).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(currentCanvasState.deleteNode).not.toHaveBeenCalled();
  });
});

describe('FlowEditorPage submenu behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    setWindowWidth(1440);
    currentCanvasState = buildCanvasState();
    flowCanvasMock.useFlowCanvas.mockImplementation(() => currentCanvasState);
  });

  it('re-anchors the tree to the real root when opening a submenu route directly', async () => {
    const submenuFlow = buildFlowDetail({
      id: 55,
      name: 'Billing submenu',
      slug: 'billing-submenu',
      parentFlowId: 1,
      parentNodeKey: 'menu-1',
      parentBranchKey: '1',
    });

    vi.mocked(api.getFlow).mockResolvedValue({ data: submenuFlow });
    vi.mocked(api.getFlowBreadcrumb).mockResolvedValue({
      data: [
        { flowId: 1, flowName: 'Root Flow', parentNodeKey: null, parentNodeLabel: null, parentBranchKey: null },
        { flowId: 55, flowName: 'Billing submenu', parentNodeKey: 'menu-1', parentNodeLabel: 'Main Menu', parentBranchKey: '1' },
      ],
    });
    vi.mocked(api.getFlowTree).mockResolvedValue({
      data: { id: 1, name: 'Root Flow', children: [] },
    });

    renderFlowEditor('/flows/55');

    await waitFor(() => {
      expect(api.getFlowTree).toHaveBeenCalledWith(1);
    });
  });

  it('creates a nested submenu under the active submenu flow instead of assuming the root flow', async () => {
    const startNode: Node<FlowNodeData> = {
      id: 'start',
      type: 'flowNode',
      position: { x: 120, y: 140 },
      data: { type: 'start', label: 'Start', config: {}, subflowId: null },
      draggable: false,
    };
    const menuNode: Node<FlowNodeData> = {
      id: 'menu-2',
      type: 'menuNode',
      position: { x: 320, y: 140 },
      data: {
        type: 'menu',
        label: 'Billing Menu',
        config: {
          branches: ['1'],
          prompt_audio_file_id: 1,
          submenu_branch_names: { '1': 'Nested Billing submenu' },
        },
        subflowId: null,
      },
      draggable: true,
    };
    const submenuFlow = buildFlowDetail({
      id: 55,
      name: 'Billing submenu',
      slug: 'billing-submenu',
      parentFlowId: 1,
      parentNodeKey: 'menu-1',
      parentBranchKey: '1',
      nodes: [
        { id: 1, nodeKey: 'start', type: 'start', label: 'Start', positionX: 120, positionY: 140, config: {}, groupId: null, subflowId: null },
        {
          id: 2,
          nodeKey: 'menu-2',
          type: 'menu',
          label: 'Billing Menu',
          positionX: 320,
          positionY: 140,
          config: {
            branches: ['1'],
            prompt_audio_file_id: 1,
            submenu_branch_names: { '1': 'Nested Billing submenu' },
            submenu_branch_flows: {},
          },
          groupId: null,
          subflowId: null,
        },
      ],
      edges: [{ id: 10, sourceNodeKey: 'start', targetNodeKey: 'menu-2', branchKey: 'default', condition: null }],
    });

    vi.mocked(api.getFlow).mockResolvedValue({ data: submenuFlow });
    vi.mocked(api.getFlowBreadcrumb).mockResolvedValue({
      data: [
        { flowId: 1, flowName: 'Root Flow', parentNodeKey: null, parentNodeLabel: null, parentBranchKey: null },
        { flowId: 55, flowName: 'Billing submenu', parentNodeKey: 'menu-1', parentNodeLabel: 'Main Menu', parentBranchKey: '1' },
      ],
    });
    vi.mocked(api.getFlowTree).mockResolvedValue({ data: { id: 1, name: 'Root Flow', children: [] } });
    vi.mocked(api.createFlow).mockResolvedValue({
      data: buildFlowDetail({
        id: 77,
        name: 'Nested Billing submenu',
        slug: 'nested-billing-submenu',
        parentFlowId: 55,
        parentNodeKey: 'menu-2',
        parentBranchKey: '1',
        nodes: [{ id: 3, nodeKey: 'start', type: 'start', label: 'Start', positionX: 120, positionY: 140, config: {}, groupId: null, subflowId: null }],
      }),
    });

    currentCanvasState = buildCanvasState({
      nodes: [startNode, menuNode],
      edges: [{ id: 'start-menu', source: 'start', target: 'menu-2', data: { branchKey: 'default', condition: null, sourceNodeType: 'start' } }],
      selectedNode: menuNode,
    });
    flowCanvasMock.useFlowCanvas.mockImplementation(() => currentCanvasState);

    const user = userEvent.setup();
    renderFlowEditor('/flows/55');

    await screen.findByRole('navigation', { name: 'Flow breadcrumb' });
    expect(screen.getByText('Billing submenu')).toBeInTheDocument();
    const createButton = await screen.findByRole('button', { name: 'Create submenu' });
    await user.click(createButton);

    await waitFor(() => {
      expect(api.createFlow).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Nested Billing submenu',
        parentFlowId: 55,
        parentNodeKey: 'menu-2',
        parentBranchKey: '1',
      }));
    });
  });

  it('autosaves submenu edits with the backend autoSave flag before navigation warnings are needed', async () => {
    vi.useFakeTimers();

    const currentNodes: Array<Node<FlowNodeData>> = [
      {
        id: 'start',
        type: 'flowNode',
        position: { x: 120, y: 140 },
        data: { type: 'start', label: 'Start', config: {}, subflowId: null },
        draggable: false,
      },
      {
        id: 'play-1',
        type: 'flowNode',
        position: { x: 320, y: 140 },
        data: { type: 'play_audio', label: 'Updated Greeting', config: { audio_file_id: 1 }, subflowId: null },
        draggable: true,
      },
    ];
    const currentEdges: Array<Edge> = [
      {
        id: 'start-play',
        source: 'start',
        target: 'play-1',
        data: { branchKey: 'default', condition: null, sourceNodeType: 'start' },
      },
    ];
    const loadedSubflow = buildFlowDetail({
      id: 55,
      name: 'Billing submenu',
      slug: 'billing-submenu',
      parentFlowId: 1,
      parentNodeKey: 'menu-1',
      parentBranchKey: '1',
      nodes: [
        { id: 1, nodeKey: 'start', type: 'start', label: 'Start', positionX: 120, positionY: 140, config: {}, groupId: null, subflowId: null },
        { id: 2, nodeKey: 'play-1', type: 'play_audio', label: 'Greeting', positionX: 320, positionY: 140, config: { audio_file_id: 1 }, groupId: null, subflowId: null },
      ],
      edges: [{ id: 10, sourceNodeKey: 'start', targetNodeKey: 'play-1', branchKey: 'default', condition: null }],
    });

    vi.mocked(api.getFlow).mockResolvedValue({ data: loadedSubflow });
    vi.mocked(api.getFlowBreadcrumb).mockResolvedValue({
      data: [
        { flowId: 1, flowName: 'Root Flow', parentNodeKey: null, parentNodeLabel: null, parentBranchKey: null },
        { flowId: 55, flowName: 'Billing submenu', parentNodeKey: 'menu-1', parentNodeLabel: 'Main Menu', parentBranchKey: '1' },
      ],
    });
    vi.mocked(api.getFlowTree).mockResolvedValue({ data: { id: 1, name: 'Root Flow', children: [] } });
    vi.mocked(api.updateFlow).mockResolvedValue({
      data: {
        ...loadedSubflow,
        nodes: [
          { id: 1, nodeKey: 'start', type: 'start', label: 'Start', positionX: 120, positionY: 140, config: {}, groupId: null, subflowId: null },
          { id: 2, nodeKey: 'play-1', type: 'play_audio', label: 'Updated Greeting', positionX: 320, positionY: 140, config: { audio_file_id: 1 }, groupId: null, subflowId: null },
        ],
      },
    });

    currentCanvasState = buildCanvasState({
      nodes: currentNodes,
      edges: currentEdges,
    });
    flowCanvasMock.useFlowCanvas.mockImplementation(() => currentCanvasState);

    renderFlowEditor('/flows/55');

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
      await Promise.resolve();
    });

    expect(api.updateFlow).toHaveBeenCalledWith('55', expect.objectContaining({
      autoSave: true,
      parentFlowId: 1,
      parentNodeKey: 'menu-1',
      parentBranchKey: '1',
    }));
  }, 10000);
});
