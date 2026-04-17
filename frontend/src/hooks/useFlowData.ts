import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getFlow,
  getFlowBreadcrumb,
  getFlowTree,
  getFlowVersion,
  listAudio,
  listFlowVersions,
  restoreFlowVersion,
} from '../lib/api';
import type {
  AudioFileItem,
  FlowBreadcrumbItem,
  FlowDetail,
  FlowTree,
  FlowVersionDetail,
  FlowVersionSummary,
} from '../types';

export interface UseFlowDataResult {
  /** The currently loaded flow detail (null while loading or on draft). */
  flow: FlowDetail | null;
  /** Setter so the page can update flow name / post-save state. */
  setFlow: React.Dispatch<React.SetStateAction<FlowDetail | null>>;

  /** Audio files fetched from the API. */
  audioItems: AudioFileItem[];

  /** Breadcrumb path for subflow navigation. */
  breadcrumb: FlowBreadcrumbItem[];
  setBreadcrumb: React.Dispatch<React.SetStateAction<FlowBreadcrumbItem[]>>;

  /** Flow tree for the left panel. */
  flowTree: FlowTree | null;
  setFlowTree: React.Dispatch<React.SetStateAction<FlowTree | null>>;

  /** Increment to force the tree to reload. */
  treeRefreshKey: number;
  incrementTreeRefreshKey: () => void;

  /** Committed version list for the versions panel. */
  versions: FlowVersionSummary[];
  setVersions: React.Dispatch<React.SetStateAction<FlowVersionSummary[]>>;
  versionsLoading: boolean;

  /** Load the version list for a given flow id. */
  loadVersions: (flowId: number) => Promise<void>;

  /** Restore a version: calls the API, then returns the reloaded FlowDetail. */
  restoreVersion: (flowId: number, versionId: number) => Promise<FlowDetail | null>;

  /** Fetch the full detail of a version (for diff overlay). */
  loadVersionDetail: (flowId: number, versionId: number) => Promise<FlowVersionDetail | null>;

  /** Load breadcrumb for a flow id. */
  loadBreadcrumb: (flowId: number) => Promise<FlowBreadcrumbItem[]>;

  /** Load the flow tree from the root flow id. */
  loadFlowTree: (rootFlowId: number) => Promise<FlowTree | null>;
}

export function useFlowData(isDraftRoute: boolean): UseFlowDataResult {
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [audioItems, setAudioItems] = useState<AudioFileItem[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<FlowBreadcrumbItem[]>([]);
  const [flowTree, setFlowTree] = useState<FlowTree | null>(null);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [versions, setVersions] = useState<FlowVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const incrementTreeRefreshKey = useCallback(() => {
    setTreeRefreshKey((current) => current + 1);
  }, []);

  // Load audio list once on mount.
  useEffect(() => {
    let active = true;
    const loadAudio = async () => {
      const response = await listAudio(1, 100);
      if (active) {
        setAudioItems(response.data);
      }
    };
    void loadAudio();
    return () => {
      active = false;
    };
  }, []);

  const loadVersions = useCallback(async (flowId: number) => {
    if (isDraftRoute || flowId <= 0) {
      return;
    }
    setVersionsLoading(true);
    try {
      const response = await listFlowVersions(flowId);
      setVersions(response.data);
    } finally {
      setVersionsLoading(false);
    }
  }, [isDraftRoute]);

  const loadBreadcrumb = useCallback(async (flowId: number): Promise<FlowBreadcrumbItem[]> => {
    const response = await getFlowBreadcrumb(flowId);
    return response.data;
  }, []);

  const loadFlowTree = useCallback(async (rootFlowId: number): Promise<FlowTree | null> => {
    if (isDraftRoute || rootFlowId <= 0) {
      return null;
    }
    const response = await getFlowTree(rootFlowId);
    return response.data;
  }, [isDraftRoute]);

  const restoreVersion = useCallback(async (flowId: number, versionId: number): Promise<FlowDetail | null> => {
    try {
      await restoreFlowVersion(flowId, versionId);
      const response = await getFlow(String(flowId));
      return response.data;
    } catch {
      return null;
    }
  }, []);

  const loadVersionDetail = useCallback(async (flowId: number, versionId: number): Promise<FlowVersionDetail | null> => {
    try {
      const response = await getFlowVersion(flowId, versionId);
      return response.data;
    } catch {
      return null;
    }
  }, []);

  return {
    flow,
    setFlow,
    audioItems,
    breadcrumb,
    setBreadcrumb,
    flowTree,
    setFlowTree,
    treeRefreshKey,
    incrementTreeRefreshKey,
    versions,
    setVersions,
    versionsLoading,
    loadVersions,
    restoreVersion,
    loadVersionDetail,
    loadBreadcrumb,
    loadFlowTree,
  };
}
