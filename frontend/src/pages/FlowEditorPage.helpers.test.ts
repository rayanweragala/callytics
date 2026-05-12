import { describe, it, expect, vi } from 'vitest';
import {
  buildPendingSubmenuIgnoreBranches,
  buildClipboardSelection,
  buildMenuSubmenuTargets,
  buildPastedClipboardSelection,
  createSavePayload,
  buildSubflowJumpVisuals,
  isImmediateHangupFlow,
  mapFlowToEdges,
  renameSubmenuFlowReferences,
  validateFlowBeforeSave,
  validateFlowTimeoutConfig,
} from './FlowEditorPage.helpers';
import type { Node, Edge } from 'reactflow';
import type { FlowDetail, FlowNodeData } from '../types';

// validateFlowBeforeSave does a dynamic import of getFlow for menu validation.
// Mock it so tests stay unit-level.
vi.mock('../lib/api', () => ({
  getFlow: vi.fn(() =>
    Promise.resolve({ data: { nodes: [{ nodeKey: 'start' }], edges: [] } }),
  ),
}));

function makeNode(id: string, type: FlowNodeData['type']): Node<FlowNodeData> {
  return {
    id,
    type: 'flowNode',
    position: { x: 0, y: 0 },
    data: { label: id, type, config: {} },
  };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

function makeFlow(overrides: Partial<FlowDetail> = {}): FlowDetail {
  return {
    id: 1,
    name: 'Test Flow',
    description: null,
    slug: 'test-flow',
    parentFlowId: null,
    parentNodeKey: null,
    parentBranchKey: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    versionId: 1,
    versionNumber: 1,
    nodes: [],
    edges: [],
    ...overrides,
  };
}

const startNode = makeNode('start', 'start');
const startEdge = makeEdge('start', 'next');
const nextNode = makeNode('next', 'hangup');

describe('flow edge handle persistence', () => {
  it('includes sourceHandle and targetHandle in the save payload for every edge', () => {
    const businessHoursNode = makeNode('hours-1', 'business_hours');
    const openNode = makeNode('open-target', 'play_audio');
    const closedNode = makeNode('closed-target', 'hangup');
    const edges: Edge[] = [
      {
        id: 'hours-open',
        source: 'hours-1',
        target: 'open-target',
        sourceHandle: 'open',
        targetHandle: null,
        data: { branchKey: 'open', condition: 'open', sourceNodeType: 'business_hours' } as any,
      },
      {
        id: 'hours-closed',
        source: 'hours-1',
        target: 'closed-target',
        sourceHandle: 'closed',
        targetHandle: 'main-input',
        data: { branchKey: 'closed', condition: 'closed', sourceNodeType: 'business_hours' } as any,
      },
    ];

    const payload = createSavePayload(
      makeFlow(),
      [businessHoursNode, openNode, closedNode],
      edges as any,
    );

    expect(payload.edges).toEqual([
      expect.objectContaining({
        sourceNodeKey: 'hours-1',
        targetNodeKey: 'open-target',
        sourceHandle: 'open',
        targetHandle: null,
      }),
      expect.objectContaining({
        sourceNodeKey: 'hours-1',
        targetNodeKey: 'closed-target',
        sourceHandle: 'closed',
        targetHandle: 'main-input',
      }),
    ]);
  });

  it('restores persisted Business Hours handles into React Flow edges', () => {
    const edges = mapFlowToEdges(makeFlow({
      nodes: [
        { id: 1, nodeKey: 'hours-1', type: 'business_hours', label: 'Hours', positionX: 0, positionY: 0, config: {}, groupId: null, subflowId: null },
        { id: 2, nodeKey: 'open-target', type: 'play_audio', label: 'Open', positionX: 200, positionY: 0, config: {}, groupId: null, subflowId: null },
        { id: 3, nodeKey: 'closed-target', type: 'hangup', label: 'Closed', positionX: 200, positionY: 100, config: {}, groupId: null, subflowId: null },
      ],
      edges: [
        { id: 11, sourceNodeKey: 'hours-1', targetNodeKey: 'open-target', branchKey: 'open', condition: 'open', sourceHandle: 'open', targetHandle: null },
        { id: 12, sourceNodeKey: 'hours-1', targetNodeKey: 'closed-target', branchKey: 'closed', condition: 'closed', sourceHandle: 'closed', targetHandle: 'main-input' },
      ],
    }));

    expect(edges).toEqual([
      expect.objectContaining({ sourceHandle: 'open', targetHandle: undefined }),
      expect.objectContaining({ sourceHandle: 'closed', targetHandle: 'main-input' }),
    ]);
  });
});

describe('validateFlowBeforeSave — terminal node types (no outgoing required)', () => {
  it('transfer with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('t1', 'transfer')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('play_audio with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('p1', 'play_audio')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('hangup with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('h1', 'hangup')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('voicemail with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('vm1', 'voicemail')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('callback with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('cb1', 'callback')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('hunt with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('hu1', 'hunt')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('webhook with a success outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('wh1', 'webhook'), nextNode];
    const edges: Edge[] = [
      makeEdge('start', 'wh1'),
      { id: 'wh1-next', source: 'wh1', target: 'next', data: { branchKey: 'success', condition: 'success', sourceNodeType: 'webhook' } as any },
    ];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('webhook with no outgoing edge: no error (webhook is async and never requires a downstream path)', async () => {
    const nodes = [startNode, makeNode('wh1', 'webhook')];
    const edges: Edge[] = [makeEdge('start', 'wh1')];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('play_audio can have normal edge plus webhook edge simultaneously', async () => {
    const nodes = [startNode, makeNode('p1', 'play_audio'), makeNode('next', 'hangup'), makeNode('wh1', 'webhook')];
    const edges: Edge[] = [
      makeEdge('start', 'p1'),
      makeEdge('p1', 'next'),
      makeEdge('p1', 'wh1'),
      { id: 'wh1-next', source: 'wh1', target: 'next', data: { branchKey: 'success', condition: 'success', sourceNodeType: 'webhook' } as any },
    ];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('menu can have normal edge plus webhook edge simultaneously', async () => {
    const nodes = [
      startNode,
      { ...makeNode('m1', 'menu'), data: { ...makeNode('m1', 'menu').data, config: { branches: ['1'] } } },
      makeNode('next', 'hangup'),
      makeNode('wh1', 'webhook'),
    ];
    const edges: Edge[] = [
      makeEdge('start', 'm1'),
      { id: 'm1-next', source: 'm1', target: 'next', data: { branchKey: '1', condition: '1', sourceNodeType: 'menu' } as any },
      { id: 'm1-wh1', source: 'm1', target: 'wh1', data: { branchKey: '1', condition: '1', sourceNodeType: 'menu' } as any },
      { id: 'wh1-next', source: 'wh1', target: 'next', data: { branchKey: 'success', condition: 'success', sourceNodeType: 'webhook' } as any },
    ];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('queue, hunt, and transfer can target webhook', async () => {
    const nodes = [
      startNode,
      makeNode('q1', 'queue'),
      makeNode('h1', 'hunt'),
      makeNode('t1', 'transfer'),
      makeNode('next', 'hangup'),
      makeNode('wh1', 'webhook'),
    ];
    const edges: Edge[] = [
      makeEdge('start', 'q1'),
      makeEdge('q1', 'next'),
      makeEdge('q1', 'wh1'),
      makeEdge('h1', 'next'),
      makeEdge('h1', 'wh1'),
      makeEdge('t1', 'next'),
      makeEdge('t1', 'wh1'),
      { id: 'wh1-next', source: 'wh1', target: 'next', data: { branchKey: 'success', condition: 'success', sourceNodeType: 'webhook' } as any },
    ];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });
});

describe('validateFlowBeforeSave — nodes that require outgoing edges', () => {
  it('get_digits with no outgoing edge: error returned', async () => {
    const nodes = [startNode, makeNode('gd1', 'get_digits')];
    const edges = [startEdge];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toMatch(/no outgoing path/i);
  });

  it('start with no outgoing edge: error returned', async () => {
    const nodes = [makeNode('start', 'start'), nextNode];
    const edges: Edge[] = []; // start has no outgoing
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toMatch(/no outgoing path/i);
  });

  it('start with one outgoing edge: no error for that rule', async () => {
    const nodes = [makeNode('start', 'start'), nextNode];
    const edges = [makeEdge('start', 'next')];
    const result = await validateFlowBeforeSave(nodes, edges);
    expect(result).toBeNull();
  });

  it('start to voicemail does not count as immediate hangup publish block', () => {
    const nodes = [makeNode('start', 'start'), makeNode('vm1', 'voicemail')];
    const edges = [makeEdge('start', 'vm1')];
    expect(isImmediateHangupFlow(nodes, edges)).toBe(false);
  });

  it('start to hangup does not count as immediate hangup when extra nodes exist', () => {
    const nodes = [makeNode('start', 'start'), makeNode('h1', 'hangup'), makeNode('pa1', 'play_audio')];
    const edges = [makeEdge('start', 'h1')];
    expect(isImmediateHangupFlow(nodes, edges)).toBe(false);
  });
});

describe('validateFlowBeforeSave — menu branch routing', () => {
  it('returns an error when a configured menu branch has no local route or submenu', async () => {
    const nodes = [
      startNode,
      {
        ...makeNode('menu1', 'menu'),
        data: {
          ...makeNode('menu1', 'menu').data,
          label: 'Main menu',
          config: { branches: ['1', '3'] },
        },
      },
      nextNode,
    ];
    const edges: Edge[] = [
      makeEdge('start', 'menu1'),
      { id: 'menu1-next', source: 'menu1', target: 'next', data: { branchKey: '1', condition: '1', sourceNodeType: 'menu' } as any },
    ];

    const result = await validateFlowBeforeSave(nodes, edges);

    expect(result).toBe('Menu "Main menu" is missing route(s) for: 3.');
  });

  it('allows the exact pending submenu branch to be ignored during pre-create save', async () => {
    const nodes = [
      startNode,
      {
        ...makeNode('menu1', 'menu'),
        data: {
          ...makeNode('menu1', 'menu').data,
          label: 'Main menu',
          config: { branches: ['1', '3'] },
        },
      },
      nextNode,
    ];
    const edges: Edge[] = [
      makeEdge('start', 'menu1'),
      { id: 'menu1-next', source: 'menu1', target: 'next', data: { branchKey: '1', condition: '1', sourceNodeType: 'menu' } as any },
    ];

    const result = await validateFlowBeforeSave(nodes, edges, {
      ignoreMenuBranches: [{ nodeId: 'menu1', branch: '3' }],
    });

    expect(result).toBeNull();
  });

  it('allows multiple unrouted branches on the same menu to be configured one submenu at a time', async () => {
    const nodes = [
      startNode,
      {
        ...makeNode('menu1', 'menu'),
        data: {
          ...makeNode('menu1', 'menu').data,
          label: 'Menu group',
          config: { branches: ['6', '7'] },
        },
      },
    ];
    const edges: Edge[] = [
      makeEdge('start', 'menu1'),
    ];

    const ignoreMenuBranches = buildPendingSubmenuIgnoreBranches(nodes, edges as any, {
      nodeId: 'menu1',
      branch: '6',
    });

    expect(ignoreMenuBranches).toEqual([
      { nodeId: 'menu1', branch: '6' },
      { nodeId: 'menu1', branch: '7' },
    ]);

    const result = await validateFlowBeforeSave(nodes, edges as any, {
      ignoreMenuBranches,
    });

    expect(result).toBeNull();
  });
});

describe('validateFlowTimeoutConfig', () => {
  it('returns warning when queue_login uses flow default but start default is missing', () => {
    const nodes = [
      makeNode('start', 'start'),
      {
        ...makeNode('ql1', 'queue_login'),
        data: {
          ...makeNode('ql1', 'queue_login').data,
          config: { queue_ids: [1], use_flow_default_timeout: true },
        },
      },
    ];

    const result = validateFlowTimeoutConfig(nodes);
    expect(result.errors).toEqual([]);
    expect(result.warningCount).toBe(1);
  });

  it('returns no warning when queue_login uses flow default and start default is valid', () => {
    const nodes = [
      {
        ...makeNode('start', 'start'),
        data: {
          ...makeNode('start', 'start').data,
          config: { flow_default_timeout_ms: 10000 },
        },
      },
      {
        ...makeNode('ql1', 'queue_login'),
        data: {
          ...makeNode('ql1', 'queue_login').data,
          config: { queue_ids: [1], use_flow_default_timeout: true },
        },
      },
    ];

    const result = validateFlowTimeoutConfig(nodes);
    expect(result.errors).toEqual([]);
    expect(result.warningCount).toBe(0);
  });

  it('returns error when queue_login custom timeout is missing', () => {
    const nodes = [
      {
        ...makeNode('start', 'start'),
        data: {
          ...makeNode('start', 'start').data,
          config: { flow_default_timeout_ms: 10000 },
        },
      },
      {
        ...makeNode('ql1', 'queue_login'),
        data: {
          ...makeNode('ql1', 'queue_login').data,
          config: { queue_ids: [1], use_flow_default_timeout: false, input_timeout_ms: null },
        },
      },
    ];

    const result = validateFlowTimeoutConfig(nodes);
    expect(result.errors.length).toBe(1);
    expect(result.warningCount).toBe(0);
  });

  it('skips start timeout validation for subflows', () => {
    const nodes = [
      makeNode('start', 'start'),
      {
        ...makeNode('ql1', 'queue_login'),
        data: {
          ...makeNode('ql1', 'queue_login').data,
          config: { queue_ids: [1], use_flow_default_timeout: true },
        },
      },
    ];

    const result = validateFlowTimeoutConfig(nodes, { isSubflow: true });
    expect(result.errors).toEqual([]);
    expect(result.warningCount).toBe(1);
  });
});

describe('buildMenuSubmenuTargets', () => {
  it('auto-assigns submenu start to branches without local edges', () => {
    const result = buildMenuSubmenuTargets({
      configuredBranches: ['1', '2'],
      currentTargets: {},
      localEdgeBranches: new Set(['2']),
      submenuStartNodeKey: 'start',
    });

    expect(result).toEqual({ '1': 'start' });
  });

  it('removes submenu targets for branches now handled by local edges', () => {
    const result = buildMenuSubmenuTargets({
      configuredBranches: ['1', '2'],
      currentTargets: { '1': 'start', '2': 'start' },
      localEdgeBranches: new Set(['2']),
      submenuStartNodeKey: 'start',
    });

    expect(result).toEqual({ '1': 'start' });
  });
});

describe('buildSubflowJumpVisuals', () => {
  it('places submenu anchors in a right-side column with fixed vertical spacing', () => {
    const nodes = [
      {
        ...makeNode('menu-a', 'menu'),
        position: { x: 100, y: 100 },
        data: {
          ...makeNode('menu-a', 'menu').data,
          config: {
            branches: ['1', '2', '3'],
            submenu_branch_flows: {
              '1': { flowId: 11, name: 'Sales submenu' },
              '2': { flowId: 22, name: 'Billing submenu' },
              '3': { flowId: 33, name: 'Support submenu' },
            },
          },
        },
      },
    ];

    const visuals = buildSubflowJumpVisuals(nodes, []);

    expect(visuals.nodes).toHaveLength(3);
    expect(visuals.nodes[0].position.y).toBe(100);
    expect(visuals.nodes[0].position.x).toBeGreaterThan(100);
    expect(visuals.nodes[1].position.y).toBe(visuals.nodes[0].position.y + 44 + 80);
    expect(visuals.nodes[2].position.y).toBe(visuals.nodes[1].position.y + 44 + 80);
  });

  it('shifts submenu columns right when nearby menus would otherwise overlap the first anchor row', () => {
    const nodes = [
      {
        ...makeNode('menu-a', 'menu'),
        position: { x: 100, y: 100 },
        data: {
          ...makeNode('menu-a', 'menu').data,
          config: {
            branches: ['1'],
            submenu_branch_flows: { '1': { flowId: 11, name: 'Sales submenu' } },
          },
        },
      },
      {
        ...makeNode('menu-b', 'menu'),
        position: { x: 120, y: 100 },
        data: {
          ...makeNode('menu-b', 'menu').data,
          config: {
            branches: ['2'],
            submenu_branch_flows: { '2': { flowId: 22, name: 'Billing submenu' } },
          },
        },
      },
    ];

    const visuals = buildSubflowJumpVisuals(nodes, []);

    expect(visuals.nodes).toHaveLength(2);
    expect(visuals.nodes[0].position.y).toBe(100);
    expect(visuals.nodes[1].position.y).toBe(100);
    expect(visuals.nodes[1].position.x).toBeGreaterThan(visuals.nodes[0].position.x);
  });

  it('adds later submenu anchors below existing submenu anchors for the same menu', () => {
    const menuNode = {
      ...makeNode('menu-a', 'menu'),
      position: { x: 100, y: 100 },
      data: {
        ...makeNode('menu-a', 'menu').data,
        config: {
          branches: ['1', '2', '3'],
          submenu_branch_flows: {
            '1': { flowId: 11, name: 'Sales submenu' },
            '3': { flowId: 33, name: 'Support submenu' },
          },
        },
      },
    };

    const firstVisuals = buildSubflowJumpVisuals([menuNode], []);
    const secondMenuNode = {
      ...menuNode,
      data: {
        ...menuNode.data,
        config: {
          ...menuNode.data.config,
          submenu_branch_flows: {
            '1': { flowId: 11, name: 'Sales submenu' },
            '2': { flowId: 22, name: 'Billing submenu' },
            '3': { flowId: 33, name: 'Support submenu' },
          },
        },
      },
    };

    const secondVisuals = buildSubflowJumpVisuals([secondMenuNode], []);

    expect(firstVisuals.nodes).toHaveLength(2);
    expect(secondVisuals.nodes).toHaveLength(3);
    expect(secondVisuals.nodes[2].position.y).toBe(secondVisuals.nodes[1].position.y + 44 + 80);
  });
});

describe('clipboard selection helpers', () => {
  it('copies a selected group together with its child nodes and internal edges', () => {
    const nodes = [
      {
        id: 'group-1',
        type: 'group',
        position: { x: 100, y: 100 },
        data: { label: 'Group 1', type: 'group', config: { width: 260, height: 200 } },
        style: { width: 260, height: 200 },
      } as Node<FlowNodeData>,
      {
        id: 'node-a',
        type: 'flowNode',
        position: { x: 20, y: 30 },
        parentId: 'group-1',
        extent: 'parent',
        data: { label: 'A', type: 'play_audio', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
      {
        id: 'node-b',
        type: 'flowNode',
        position: { x: 20, y: 120 },
        parentId: 'group-1',
        extent: 'parent',
        data: { label: 'B', type: 'hangup', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
    ];
    const edges: Edge[] = [
      { id: 'edge-a-b', source: 'node-a', target: 'node-b', data: { branchKey: 'default', condition: null, sourceNodeType: 'play_audio' } as any },
    ];

    const copied = buildClipboardSelection(nodes, edges as any, ['group-1']);

    expect(copied?.nodes.map((node) => node.id)).toEqual(['group-1', 'node-a', 'node-b']);
    expect(copied?.edges.map((edge) => edge.id)).toEqual(['edge-a-b']);
  });

  it('pastes grouped nodes with regenerated ids, preserved child positions, and remapped edges', () => {
    const copied = buildClipboardSelection([
      {
        id: 'group-1',
        type: 'group',
        position: { x: 100, y: 100 },
        data: { label: 'Group 1', type: 'group', config: { width: 260, height: 200 } },
        style: { width: 260, height: 200 },
      } as Node<FlowNodeData>,
      {
        id: 'node-a',
        type: 'flowNode',
        position: { x: 20, y: 30 },
        parentId: 'group-1',
        extent: 'parent',
        data: { label: 'A', type: 'play_audio', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
      {
        id: 'node-b',
        type: 'flowNode',
        position: { x: 20, y: 120 },
        parentId: 'group-1',
        extent: 'parent',
        data: { label: 'B', type: 'hangup', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
    ], [
      { id: 'edge-a-b', source: 'node-a', target: 'node-b', data: { branchKey: 'default', condition: null, sourceNodeType: 'play_audio' } as any },
    ] as any, ['group-1']);

    expect(copied).not.toBeNull();

    const pasted = buildPastedClipboardSelection(copied!, { timestamp: 123, offsetX: 40, offsetY: 40 });
    const pastedGroup = pasted.nodes.find((node) => node.data.type === 'group');
    const pastedChild = pasted.nodes.find((node) => node.data.label === 'A');

    expect(pastedGroup?.id).toBe('group-123-0');
    expect(pastedGroup?.position).toEqual({ x: 140, y: 140 });
    expect(pastedChild?.parentId).toBe('group-123-0');
    expect(pastedChild?.position).toEqual({ x: 20, y: 30 });
    expect(pasted.edges[0]).toEqual(expect.objectContaining({
      id: 'edge-123-0',
      source: 'play_audio-123-1',
      target: 'hangup-123-2',
    }));
  });

  it('drops a pasted start node and rewires its outgoing edges to the existing start node', () => {
    const copied = buildClipboardSelection([
      {
        id: 'start',
        type: 'flowNode',
        position: { x: 0, y: 0 },
        data: { label: 'Start', type: 'start', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
      {
        id: 'node-a',
        type: 'flowNode',
        position: { x: 200, y: 80 },
        data: { label: 'A', type: 'play_audio', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
    ], [
      { id: 'edge-start-a', source: 'start', target: 'node-a', data: { branchKey: 'default', condition: null, sourceNodeType: 'start' } as any },
    ] as any, ['start', 'node-a']);

    expect(copied).not.toBeNull();

    const pasted = buildPastedClipboardSelection(copied!, {
      timestamp: 456,
      existingStartNodeId: 'root-start',
    });

    expect(pasted.nodes.map((node) => node.data.type)).toEqual(['play_audio']);
    expect(pasted.edges).toEqual([
      expect.objectContaining({
        source: 'root-start',
        target: 'play_audio-456-1',
      }),
    ]);
  });

  it('drops edges that would point into the existing start node when pasted start is removed', () => {
    const copied = buildClipboardSelection([
      {
        id: 'start',
        type: 'flowNode',
        position: { x: 0, y: 0 },
        data: { label: 'Start', type: 'start', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
      {
        id: 'node-a',
        type: 'flowNode',
        position: { x: 200, y: 80 },
        data: { label: 'A', type: 'play_audio', config: {}, subflowId: null },
      } as Node<FlowNodeData>,
    ], [
      { id: 'edge-a-start', source: 'node-a', target: 'start', data: { branchKey: 'default', condition: null, sourceNodeType: 'play_audio' } as any },
    ] as any, ['start', 'node-a']);

    expect(copied).not.toBeNull();

    const pasted = buildPastedClipboardSelection(copied!, {
      timestamp: 789,
      existingStartNodeId: 'root-start',
    });

    expect(pasted.nodes.map((node) => node.data.type)).toEqual(['play_audio']);
    expect(pasted.edges).toEqual([]);
  });
});

describe('renameSubmenuFlowReferences', () => {
  it('updates matching submenu names inside menu node config', () => {
    const nodes = [
      {
        ...makeNode('menu-1', 'menu'),
        data: {
          ...makeNode('menu-1', 'menu').data,
          config: {
            branches: ['1', '2'],
            submenu_branch_flows: {
              '1': { flowId: 1686, name: 'Sales submenu' },
              '2': { flowId: 1700, name: 'Support submenu' },
            },
          },
        },
      },
      makeNode('play-1', 'play_audio'),
    ];

    const result = renameSubmenuFlowReferences(nodes, 1686, 'sales_menu');
    const renamedFlows = (result[0].data.config.submenu_branch_flows || {}) as Record<string, { flowId: number; name: string }>;

    expect(renamedFlows['1']).toEqual({ flowId: 1686, name: 'sales_menu' });
    expect(renamedFlows['2']).toEqual({ flowId: 1700, name: 'Support submenu' });
    expect(result[1]).toBe(nodes[1]);
  });
});
