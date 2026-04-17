import { describe, it, expect, vi } from 'vitest';
import { validateFlowBeforeSave } from './FlowEditorPage.helpers';
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

  it('hunt with no outgoing edge: no error', async () => {
    const nodes = [startNode, makeNode('hu1', 'hunt')];
    const edges = [startEdge];
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
});
