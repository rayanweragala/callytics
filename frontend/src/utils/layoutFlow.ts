import dagre from '@dagrejs/dagre';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types';

const NODE_WIDTH = 220;
const NODE_HEIGHT = 100;

export function layoutFlow(nodes: Array<Node<FlowNodeData>>, edges: Array<Edge>): Array<Node<FlowNodeData>> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    ranksep: 100,
    nodesep: 60,
    marginx: 60,
    marginy: 60,
  });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) {
      return node;
    }

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });
}
