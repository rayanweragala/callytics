import { describe, it, expect } from 'vitest';
import { layoutFlow } from './layoutFlow';
import type { Node, Edge } from 'reactflow';
import type { BuilderNodeType, FlowNodeData } from '../types';

describe('layoutFlow', () => {
  const createNode = (id: string, type: BuilderNodeType = 'start'): Node<FlowNodeData> => ({
    id,
    type: 'custom',
    data: {
      type,
      label: id,
      config: {},
    },
    position: { x: 0, y: 0 },
  });

  it('returns nodes with x/y position fields', () => {
    const nodes = [createNode('1'), createNode('2')];
    const edges: Edge[] = [{ id: 'e1-2', source: '1', target: '2' }];
    const result = layoutFlow(nodes, edges);

    expect(result[0].position.x).toBeDefined();
    expect(result[0].position.y).toBeDefined();
    expect(result[1].position.x).toBeDefined();
    expect(result[1].position.y).toBeDefined();
  });

  it('output node count equals input node count', () => {
    const nodes = [createNode('1'), createNode('2'), createNode('3')];
    const result = layoutFlow(nodes, []);
    expect(result).toHaveLength(3);
  });

  it('empty nodes array does not throw', () => {
    expect(() => layoutFlow([], [])).not.toThrow();
    expect(layoutFlow([], [])).toEqual([]);
  });

  it('single node returns that node with a position', () => {
    const nodes = [createNode('1')];
    const result = layoutFlow(nodes, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].position).toBeDefined();
  });

  it('handles group nodes', () => {
    const nodes = [createNode('1', 'group')];
    const result = layoutFlow(nodes, []);
    expect(result[0].position).toBeDefined();
  });

  it('handles menu nodes', () => {
    const nodes = [createNode('1', 'menu')];
    const result = layoutFlow(nodes, []);
    expect(result[0].position).toBeDefined();
  });

  it('keeps grouped child positions relative to their group', () => {
    const group = {
      ...createNode('group-1', 'group'),
      position: { x: 400, y: 300 },
      style: { width: 480, height: 320 },
    };
    const child = {
      ...createNode('child-1', 'play_audio'),
      parentId: 'group-1',
      extent: 'parent' as const,
      position: { x: 40, y: 40 },
    };
    const outside = {
      ...createNode('outside', 'hangup'),
      position: { x: 900, y: 700 },
    };

    const result = layoutFlow(
      [group, child, outside],
      [{ id: 'child-outside', source: 'child-1', target: 'outside' }],
    );

    expect(result.find((node) => node.id === 'child-1')?.position).toEqual({ x: 40, y: 40 });
    expect(result.find((node) => node.id === 'group-1')?.position).not.toEqual({ x: 400, y: 300 });
    expect(result.find((node) => node.id === 'outside')?.position).not.toEqual({ x: 900, y: 700 });
  });
});
