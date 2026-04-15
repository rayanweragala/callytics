jest.mock('../db', () => ({
  query: jest.fn(),
}));

import { loadFlowById } from '../flowLoader';
import { query } from '../db';

const queryMock = query as jest.MockedFunction<typeof query>;

describe('flow loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for an unknown flow id', async () => {
    queryMock.mockResolvedValueOnce([]);

    await expect(loadFlowById(999999)).resolves.toBeNull();
  });

  it('returns a flow object with nodes and edges for an existing flow', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 5, name: 'IVR', current_version_id: 9 }])
      .mockResolvedValueOnce([
        { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
        { node_key: 'menu', type: 'get_digits', label: 'Menu', config_json: { timeout_ms: 5000 } },
      ])
      .mockResolvedValueOnce([
        { source_node_key: 'start', target_node_key: 'menu', branch_key: 'default', condition: null },
      ]);

    const flow = await loadFlowById(5);

    expect(flow).toEqual(expect.objectContaining({ id: 5, name: 'IVR', versionId: 9, nodes: expect.any(Array), edges: expect.any(Array) }));
  });

  it('correctly keys nodes by node_key semantics', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 5, name: 'IVR', current_version_id: 9 }])
      .mockResolvedValueOnce([
        { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
        { node_key: 'menu', type: 'get_digits', label: 'Menu', config_json: {} },
      ])
      .mockResolvedValueOnce([]);

    const flow = await loadFlowById(5);
    const nodesByKey = Object.fromEntries((flow?.nodes || []).map((node) => [node.nodeKey, node]));

    expect(Object.keys(nodesByKey).sort()).toEqual(['menu', 'start']);
    expect(nodesByKey.menu.type).toBe('get_digits');
  });

  it('correctly groups edges by source_node_key semantics', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 5, name: 'IVR', current_version_id: 9 }])
      .mockResolvedValueOnce([
        { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
        { node_key: 'menu', type: 'get_digits', label: 'Menu', config_json: {} },
      ])
      .mockResolvedValueOnce([
        { source_node_key: 'menu', target_node_key: 'sales', branch_key: '1', condition: '1' },
        { source_node_key: 'menu', target_node_key: 'support', branch_key: '2', condition: '2' },
      ]);

    const flow = await loadFlowById(5);
    const edgesBySource = (flow?.edges || []).reduce<Record<string, string[]>>((acc, edge) => {
      acc[edge.sourceNodeKey] = acc[edge.sourceNodeKey] || [];
      acc[edge.sourceNodeKey].push(edge.targetNodeKey);
      return acc;
    }, {});

    expect(edgesBySource.menu).toEqual(['sales', 'support']);
  });

  it('includes edge condition on get_digits edges', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 5, name: 'IVR', current_version_id: 9 }])
      .mockResolvedValueOnce([
        { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
        { node_key: 'menu', type: 'get_digits', label: 'Menu', config_json: {} },
      ])
      .mockResolvedValueOnce([
        { source_node_key: 'menu', target_node_key: 'sales', branch_key: '1', condition: '1' },
      ]);

    const flow = await loadFlowById(5);

    expect(flow?.edges[0]?.condition).toBe('1');
  });

  it('sets condition null on non-conditional edges', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 5, name: 'IVR', current_version_id: 9 }])
      .mockResolvedValueOnce([{ node_key: 'start', type: 'start', label: 'Start', config_json: {} }])
      .mockResolvedValueOnce([
        { source_node_key: 'start', target_node_key: 'menu', branch_key: 'default', condition: null },
      ]);

    const flow = await loadFlowById(5);

    expect(flow?.edges[0]?.condition).toBeNull();
  });

  it('returns null if flow has no start node', async () => {
    queryMock
      .mockResolvedValueOnce([{ id: 5, name: 'IVR', current_version_id: 9 }])
      .mockResolvedValueOnce([{ node_key: 'menu', type: 'get_digits', label: 'Menu', config_json: {} }])
      .mockResolvedValueOnce([]);

    await expect(loadFlowById(5)).resolves.toBeNull();
  });
});
