import { describe, it, expect, vi } from 'vitest';
import { buildMenuSubmenuTargets, isImmediateHangupFlow, validateFlowBeforeSave, validateFlowTimeoutConfig } from './FlowEditorPage.helpers';
import type { Node, Edge } from 'reactflow';
import type { FlowNodeData } from '../types';

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

const startNode = makeNode('start', 'start');
const startEdge = makeEdge('start', 'next');
const nextNode = makeNode('next', 'hangup');

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

  it('start to hangup still counts as immediate hangup even when extra nodes exist', () => {
    const nodes = [makeNode('start', 'start'), makeNode('h1', 'hangup'), makeNode('pa1', 'play_audio')];
    const edges = [makeEdge('start', 'h1')];
    expect(isImmediateHangupFlow(nodes, edges)).toBe(true);
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
          config: { queue_id: 1, use_flow_default_timeout: true },
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
          config: { queue_id: 1, use_flow_default_timeout: true },
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
          config: { queue_id: 1, use_flow_default_timeout: false, input_timeout_ms: null },
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
          config: { queue_id: 1, use_flow_default_timeout: true },
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
