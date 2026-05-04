import { query } from './db';

export interface FlowNode {
  nodeKey: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

export interface FlowEdge {
  sourceNodeKey: string;
  targetNodeKey: string;
  branchKey: string;
  condition: string | null;
}

export interface Flow {
  id: number;
  name: string;
  versionId: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export async function loadFlow(entryValue?: string): Promise<Flow | null> {
  const flowSql = entryValue
    ? `
      SELECT *
      FROM call_flows
      WHERE status = 'published' AND entry_value = $1
      ORDER BY id ASC
      LIMIT 1
    `
    : `
      SELECT *
      FROM call_flows
      WHERE status = 'published'
      ORDER BY id ASC
      LIMIT 1
    `;

  const flows = await query(flowSql, entryValue ? [entryValue] : []);
  return buildFlowFromRow(flows[0]);
}

export async function loadFlowById(id: number): Promise<Flow | null> {
  const flows = await query(
    `
      SELECT *
      FROM call_flows
      WHERE id = $1 AND status = 'published'
      LIMIT 1
    `,
    [id],
  );

  return buildFlowFromRow(flows[0]);
}

async function buildFlowFromRow(flowRow: Record<string, unknown> | undefined): Promise<Flow | null> {
  if (!flowRow) {
    return null;
  }

  const versionId = flowRow.current_version_id;
  if (!versionId) {
    return null;
  }

  const nodesRows = await query(
    `
      SELECT node_key, type, label, config_json
      FROM flow_nodes
      WHERE flow_version_id = $1
      ORDER BY id ASC
    `,
    [versionId],
  );

  const edgesRows = await query(
    `
      SELECT source_node_key, target_node_key, branch_key, condition
      FROM flow_edges
      WHERE flow_version_id = $1
      ORDER BY id ASC
    `,
    [versionId],
  );

  const nodes = nodesRows.map((row: { node_key: string; type: string; label: string | null; config_json: Record<string, unknown> | null }) => ({
    nodeKey: row.node_key,
    type: row.type,
    label: row.label || '',
    config: row.config_json || {},
  }));

  if (!nodes.some((node) => node.type === 'start')) {
    return null;
  }

  return {
    id: Number(flowRow.id),
    name: String(flowRow.name || ''),
    versionId: Number(versionId),
    nodes,
    edges: edgesRows.map((row: { source_node_key: string; target_node_key: string; branch_key: string | null; condition: string | null }) => ({
      sourceNodeKey: row.source_node_key,
      targetNodeKey: row.target_node_key,
      branchKey: row.branch_key || 'default',
      condition: row.condition,
    })),
  };
}
