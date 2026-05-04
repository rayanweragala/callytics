import dagre from '@dagrejs/dagre';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../types';

const DEFAULT_NODE_WIDTH = 220;
const DEFAULT_NODE_HEIGHT = 72;
const MENU_BRANCH_ROW_HEIGHT = 28;
const MENU_BASE_HEIGHT = 160;
const GROUP_MIN_WIDTH = 200;
const GROUP_MIN_HEIGHT = 150;
const HORIZONTAL_GAP = 96;
const VERTICAL_GAP = 140;
const ROW_CLUSTER_THRESHOLD = 80;

function numericValue(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function getMenuBranchCount(node: Node<FlowNodeData>): number {
  const branches = Array.isArray(node.data.config.branches)
    ? node.data.config.branches.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  const activeCount = Math.max(2, branches.length || 2);
  return activeCount + 1;
}

function getNodeDimensions(node: Node<FlowNodeData>): { width: number; height: number } {
  if (node.data.type === 'group') {
    return {
      width: Math.max(
        GROUP_MIN_WIDTH,
        numericValue(node.width ?? node.style?.width ?? node.data.config.width, GROUP_MIN_WIDTH),
      ),
      height: Math.max(
        GROUP_MIN_HEIGHT,
        numericValue(node.height ?? node.style?.height ?? node.data.config.height, GROUP_MIN_HEIGHT),
      ),
    };
  }

  if (node.data.type === 'menu') {
    const width = Math.max(DEFAULT_NODE_WIDTH + 28, numericValue(node.width ?? node.style?.width, DEFAULT_NODE_WIDTH + 28));
    const height = Math.max(
      MENU_BASE_HEIGHT + getMenuBranchCount(node) * MENU_BRANCH_ROW_HEIGHT,
      numericValue(node.height ?? node.style?.height, MENU_BASE_HEIGHT + getMenuBranchCount(node) * MENU_BRANCH_ROW_HEIGHT),
    );
    return { width, height };
  }

  return {
    width: Math.max(DEFAULT_NODE_WIDTH, numericValue(node.width ?? node.style?.width, DEFAULT_NODE_WIDTH)),
    height: Math.max(DEFAULT_NODE_HEIGHT, numericValue(node.height ?? node.style?.height, DEFAULT_NODE_HEIGHT)),
  };
}

function clusterRows(nodes: Array<{ id: string; width: number; height: number; x: number; y: number }>) {
  const sorted = [...nodes].sort((left, right) => left.y - right.y);
  const rows: Array<Array<{ id: string; width: number; height: number; x: number; y: number }>> = [];

  for (const node of sorted) {
    const row = rows[rows.length - 1];
    if (!row) {
      rows.push([node]);
      continue;
    }

    const rowCenter = row.reduce((sum, item) => sum + item.y, 0) / row.length;
    if (Math.abs(node.y - rowCenter) <= ROW_CLUSTER_THRESHOLD) {
      row.push(node);
    } else {
      rows.push([node]);
    }
  }

  return rows;
}

export function layoutFlow(nodes: Array<Node<FlowNodeData>>, edges: Array<Edge>): Array<Node<FlowNodeData>> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    ranksep: 180,
    nodesep: 120,
    marginx: 80,
    marginy: 80,
  });

  const dimensions = new Map<string, { width: number; height: number }>();

  nodes.forEach((node) => {
    const size = getNodeDimensions(node);
    dimensions.set(node.id, size);
    g.setNode(node.id, size);
  });

  edges.forEach((edge) => {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  const preliminary = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const size = dimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
    return {
      id: node.id,
      width: size.width,
      height: size.height,
      x: dagreNode ? dagreNode.x : node.position.x + size.width / 2,
      y: dagreNode ? dagreNode.y : node.position.y + size.height / 2,
    };
  });

  const rows = clusterRows(preliminary);
  const adjusted = new Map<string, { x: number; y: number }>();
  let currentRowTop = 80;

  for (const row of rows) {
    const sortedRow = [...row].sort((left, right) => left.x - right.x);
    const rowHeight = Math.max(...sortedRow.map((node) => node.height));
    let cursorX = 80;

    for (const node of sortedRow) {
      const centerX = cursorX + node.width / 2;
      const centerY = currentRowTop + rowHeight / 2;
      adjusted.set(node.id, { x: centerX, y: centerY });
      cursorX += node.width + HORIZONTAL_GAP;
    }

    currentRowTop += rowHeight + VERTICAL_GAP;
  }

  return nodes.map((node) => {
    const size = dimensions.get(node.id) || { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
    const next = adjusted.get(node.id);
    if (!next) {
      return node;
    }

    return {
      ...node,
      position: {
        x: next.x - size.width / 2,
        y: next.y - size.height / 2,
      },
    };
  });
}
