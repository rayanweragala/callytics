import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useFlowCanvas,
  buildCanvasNode,
  attachEdgeMetadata,
  calculateGroupSelectionFrame,
  GROUP_SELECTION_PADDING_TOP,
  isValidBuilderConnection,
} from './useFlowCanvas';
import { layoutFlow } from '../utils/layoutFlow';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../utils/layoutFlow', () => ({
  layoutFlow: vi.fn((nodes: unknown[]) => nodes.map((node: unknown) => ({ ...(node as object), position: { x: 0, y: 0 } }))),
}));

vi.mock('reactflow', async () => {
  const actual = await vi.importActual<typeof import('reactflow')>('reactflow');
  return {
    ...actual,
    useNodesState: vi.fn((initial: unknown[]) => {
      let state = initial;
      const setState = vi.fn((updater: unknown) => {
        if (typeof updater === 'function') { state = updater(state); } else { state = updater as unknown[]; }
      });
      return [state, setState, vi.fn()];
    }),
    useEdgesState: vi.fn((initial: unknown[]) => {
      let state = initial;
      const setState = vi.fn((updater: unknown) => {
        if (typeof updater === 'function') { state = updater(state); } else { state = updater as unknown[]; }
      });
      return [state, setState, vi.fn()];
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Helper factories ─────────────────────────────────────────────────────────

function makeNode(id: string, type = 'flowNode', dataType = 'play_audio') {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, type: dataType, config: {}, subflowId: null },
  };
}

function makeEdge(id: string, source: string, target: string) {
  return {
    id, source, target,
    data: { branchKey: 'default', condition: null, sourceNodeType: 'play_audio' },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useFlowCanvas', () => {
  it('initialises with empty nodes, edges, and null selections', () => {
    const { result } = renderHook(() => useFlowCanvas());
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);
    expect(result.current.selectedNodeId).toBeNull();
    expect(result.current.selectedEdgeId).toBeNull();
  });

  it('selecting a node sets selectedNodeId correctly', () => {
    const { result } = renderHook(() => useFlowCanvas());

    act(() => {
      result.current.handleSelectionChange({
        nodes: [makeNode('node-1')] as never,
        edges: [],
      });
    });

    expect(result.current.selectedNodeId).toBe('node-1');
    expect(result.current.selectedEdgeId).toBeNull();
  });

  it('selecting an edge clears selectedNodeId', () => {
    const { result } = renderHook(() => useFlowCanvas());

    act(() => {
      result.current.handleSelectionChange({ nodes: [], edges: [makeEdge('edge-1', 'a', 'b')] as never });
    });

    expect(result.current.selectedNodeId).toBeNull();
    expect(result.current.selectedEdgeId).toBe('edge-1');
  });

  it('deleteEdge removes the edge and clears selection', () => {
    const { result } = renderHook(() => useFlowCanvas());

    act(() => {
      result.current.setEdges([makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')] as never);
    });

    act(() => {
      result.current.setSelectedEdgeId('e1');
      result.current.deleteEdge('e1');
    });

    expect(result.current.selectedEdgeId).toBeNull();
  });

  it('triggerAutoLayout calls layoutFlow and updates node positions', () => {
    const { result } = renderHook(() => useFlowCanvas());
    const mockRfInstance = { fitView: vi.fn().mockResolvedValue(undefined) } as never;

    act(() => {
      result.current.triggerAutoLayout(mockRfInstance);
    });

    expect(layoutFlow).toHaveBeenCalled();
  });

  it('handleDragStart stores the node type in sessionStorage', () => {
    // Clear any pre-existing value
    sessionStorage.removeItem('flow-builder-node-type');
    const { result } = renderHook(() => useFlowCanvas());

    act(() => {
      result.current.handleDragStart('play_audio');
    });

    expect(sessionStorage.getItem('flow-builder-node-type')).toBe('play_audio');
  });

  it('handlePaneClick clears all selections', () => {
    const { result } = renderHook(() => useFlowCanvas());

    act(() => {
      result.current.handleSelectionChange({ nodes: [makeNode('n1')] as never, edges: [] });
    });

    act(() => {
      result.current.handlePaneClick({ target: document.createElement('div') });
    });

    expect(result.current.selectedNodeId).toBeNull();
    expect(result.current.selectedEdgeId).toBeNull();
  });
});

// ─── buildCanvasNode ──────────────────────────────────────────────────────────

describe('buildCanvasNode', () => {
  it('creates a play_audio node with correct defaults', () => {
    const node = buildCanvasNode('play_audio', 0);
    expect(node.data.type).toBe('play_audio');
    expect(node.data.config).toMatchObject({ audio_file_path: '', audio_file_id: '' });
    expect(node.type).toBe('flowNode');
  });

  it('creates a hunt node with huntNode type', () => {
    const node = buildCanvasNode('hunt', 0);
    expect(node.type).toBe('huntNode');
    expect(node.data.config).toMatchObject({ strategy: 'sequential' });
  });

  it('creates a menu node with menuNode type', () => {
    const node = buildCanvasNode('menu', 0);
    expect(node.type).toBe('menuNode');
    expect(node.data.config).toMatchObject({ branches: ['1', '2'] });
  });

  it('creates a group node with group type and group style', () => {
    const node = buildCanvasNode('group', 0);
    expect(node.type).toBe('group');
    expect(node.style).toMatchObject({ width: 200, height: 150 });
  });

  it('creates a callback node with callback defaults', () => {
    const node = buildCanvasNode('callback', 0);
    expect(node.type).toBe('flowNode');
    expect(node.data.type).toBe('callback');
    expect(node.data.label).toBe('Callback');
    expect(node.data.config).toMatchObject({
      number_source: 'ani',
      confirmation_audio_id: null,
    });
  });
});

describe('calculateGroupSelectionFrame', () => {
  it('adds enough top clearance to keep the group label above the topmost child node', () => {
    const frame = calculateGroupSelectionFrame([
      {
        ...makeNode('node-a'),
        position: { x: 120, y: 180 },
        style: { width: 170, height: 72 },
      },
      {
        ...makeNode('node-b'),
        position: { x: 320, y: 240 },
        style: { width: 170, height: 72 },
      },
    ] as never);

    expect(frame.groupPosition).toEqual({ x: 96, y: 116 });
    expect(frame.groupHeight).toBeGreaterThanOrEqual(200);
    expect(180 - frame.groupPosition.y).toBe(GROUP_SELECTION_PADDING_TOP);
  });
});

// ─── attachEdgeMetadata ───────────────────────────────────────────────────────

describe('attachEdgeMetadata', () => {
  it('attaches onDelete handler to each edge', () => {
    const onDelete = vi.fn();
    const nodes = [makeNode('a', 'flowNode', 'play_audio'), makeNode('b', 'flowNode', 'hangup')];
    const edges = [makeEdge('e1', 'a', 'b')];

    const result = attachEdgeMetadata(edges as never, nodes as never, onDelete);
    result[0].data?.onDelete?.('e1');

    expect(onDelete).toHaveBeenCalledWith('e1');
  });

  it('sets type to flowEdge on all edges', () => {
    const nodes = [makeNode('a', 'flowNode', 'play_audio'), makeNode('b', 'flowNode', 'hangup')];
    const edges = [makeEdge('e1', 'a', 'b')];
    const result = attachEdgeMetadata(edges as never, nodes as never, vi.fn());
    expect(result[0].type).toBe('flowEdge');
  });
});

describe('isValidBuilderConnection', () => {
  it.each(['hangup', 'transfer', 'voicemail', 'callback', 'queue_login'])(
    'allows outgoing connections from %s source nodes when target is webhook',
    (sourceType) => {
      const nodes = [
        makeNode('source', 'flowNode', sourceType),
        makeNode('target', 'flowNode', 'webhook'),
      ];

      expect(
        isValidBuilderConnection(
          { source: 'source', target: 'target', sourceHandle: null, targetHandle: null },
          nodes as never,
        ),
      ).toBe(true);
    },
  );

  it('allows menu to connect to webhook before any other source restrictions are checked', () => {
    const nodes = [
      makeNode('source', 'flowNode', 'menu'),
      makeNode('target', 'flowNode', 'webhook'),
    ];

    expect(
      isValidBuilderConnection(
        { source: 'source', target: 'target', sourceHandle: '1', targetHandle: null },
        nodes as never,
      ),
    ).toBe(true);
  });

  it.each(['hangup', 'transfer', 'voicemail', 'callback', 'queue_login'])(
    'rejects outgoing connections from %s source nodes to non-webhook targets',
    (sourceType) => {
      const nodes = [
        makeNode('source', 'flowNode', sourceType),
        makeNode('target', 'flowNode', 'play_audio'),
      ];

      expect(
        isValidBuilderConnection(
          { source: 'source', target: 'target', sourceHandle: null, targetHandle: null },
          nodes as never,
        ),
      ).toBe(false);
    },
  );

  it('rejects transfer → transfer connection (transfer is a terminal node)', () => {
    const nodes = [
      makeNode('source', 'flowNode', 'transfer'),
      makeNode('target', 'flowNode', 'transfer'),
    ];

    expect(
      isValidBuilderConnection(
        { source: 'source', target: 'target', sourceHandle: null, targetHandle: null },
        nodes as never,
      ),
    ).toBe(false);
  });

  it('allows start to connect directly to queue_login', () => {
    const nodes = [
      makeNode('start', 'flowNode', 'start'),
      makeNode('queue-login', 'flowNode', 'queue_login'),
    ];

    expect(
      isValidBuilderConnection(
        { source: 'start', target: 'queue-login', sourceHandle: null, targetHandle: null },
        nodes as never,
      ),
    ).toBe(true);
  });
});
