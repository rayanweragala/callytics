import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFlowData } from './useFlowData';

// ─── API mocks ────────────────────────────────────────────────────────────────

vi.mock('../lib/api', () => ({
  listAudio: vi.fn(),
  listFlowVersions: vi.fn(),
  getFlow: vi.fn(),
  getFlowBreadcrumb: vi.fn(),
  getFlowTree: vi.fn(),
  getFlowVersion: vi.fn(),
  restoreFlowVersion: vi.fn(),
}));

import * as api from '../lib/api';

const mockAudioItems = [
  { id: 1, name: 'hold-music.wav', sourceType: 'upload', originalFilename: null, mimeType: null, durationMs: null, conversionStatus: 'done', ttsText: null, ttsVoice: null, speed: 1, originalUrl: null, previewUrl: null, convertedUrl: null, createdAt: '', updatedAt: '' },
];

const mockVersions = [
  { id: 10, flowId: 1, versionNum: 1, message: 'initial', nodeCount: 2, createdAt: '2024-01-01T00:00:00Z' },
];

const mockFlow = {
  id: 1, name: 'My Flow', description: null, slug: 'my-flow', parentFlowId: null, parentNodeKey: null,
  createdAt: '2024-01-01', updatedAt: '2024-01-01', versionId: 5, versionNumber: 1, nodes: [], edges: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.listAudio as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockAudioItems });
  (api.listFlowVersions as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockVersions });
  (api.getFlow as ReturnType<typeof vi.fn>).mockResolvedValue({ data: mockFlow });
  (api.getFlowBreadcrumb as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
  (api.getFlowTree as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 1, name: 'My Flow', children: [] } });
  (api.getFlowVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { id: 10, flowId: 1, versionNum: 1, message: 'initial', nodeCount: 2, createdAt: '2024-01-01', snapshot: { nodes: [], edges: [] } } });
  (api.restoreFlowVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { success: true } });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useFlowData', () => {
  it('loads audio items on mount', async () => {
    const { result } = renderHook(() => useFlowData(false));

    await waitFor(() => {
      expect(result.current.audioItems).toHaveLength(1);
      expect(result.current.audioItems[0].name).toBe('hold-music.wav');
    });

    expect(api.listAudio).toHaveBeenCalledWith(1, 100);
  });

  it('loadVersions calls the correct API endpoint', async () => {
    const { result } = renderHook(() => useFlowData(false));

    await act(async () => {
      await result.current.loadVersions(42);
    });

    expect(api.listFlowVersions).toHaveBeenCalledWith(42);
    expect(result.current.versions).toEqual(mockVersions);
  });

  it('loadVersions does nothing when isDraftRoute is true', async () => {
    const { result } = renderHook(() => useFlowData(true));

    await act(async () => {
      await result.current.loadVersions(42);
    });

    expect(api.listFlowVersions).not.toHaveBeenCalled();
  });

  it('restoreVersion calls API then returns reloaded flow', async () => {
    const { result } = renderHook(() => useFlowData(false));

    let restoredFlow;
    await act(async () => {
      restoredFlow = await result.current.restoreVersion(1, 10);
    });

    expect(api.restoreFlowVersion).toHaveBeenCalledWith(1, 10);
    expect(api.getFlow).toHaveBeenCalledWith('1');
    expect(restoredFlow).toEqual(mockFlow);
  });

  it('restoreVersion returns null when API throws', async () => {
    (api.restoreFlowVersion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useFlowData(false));

    let restoredFlow;
    await act(async () => {
      restoredFlow = await result.current.restoreVersion(1, 10);
    });

    expect(restoredFlow).toBeNull();
  });

  it('loadFlowTree returns null for draft routes', async () => {
    const { result } = renderHook(() => useFlowData(true));

    let tree;
    await act(async () => {
      tree = await result.current.loadFlowTree(1);
    });

    expect(api.getFlowTree).not.toHaveBeenCalled();
    expect(tree).toBeNull();
  });

  it('loadFlowTree fetches from API for real flows', async () => {
    const { result } = renderHook(() => useFlowData(false));

    await act(async () => {
      await result.current.loadFlowTree(5);
    });

    expect(api.getFlowTree).toHaveBeenCalledWith(5);
  });
});
