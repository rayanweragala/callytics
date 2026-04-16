import { vi } from 'vitest';

export const listFlows = vi.fn(() => Promise.resolve({ data: [], total: 0, page: 1, limit: 5, totalPages: 0 }));
export const getFlow = vi.fn(() => Promise.resolve({ data: {} }));
export const getFlowBreadcrumb = vi.fn(() => Promise.resolve({ data: [] }));
export const getFlowTree = vi.fn(() => Promise.resolve({ data: { id: 0, name: '', children: [] } }));
export const createFlow = vi.fn(() => Promise.resolve({ data: {} }));
export const updateFlow = vi.fn(() => Promise.resolve({ data: {} }));
export const deleteFlow = vi.fn(() => Promise.resolve({ data: { id: 0, deleted: true } }));
export const listFlowVersions = vi.fn(() => Promise.resolve({ data: [] }));
export const getFlowVersion = vi.fn(() => Promise.resolve({ data: {} }));
export const createFlowVersion = vi.fn(() => Promise.resolve({ data: {} }));
export const restoreFlowVersion = vi.fn(() => Promise.resolve({ data: { success: true } }));
export const listAudio = vi.fn(() => Promise.resolve({ data: [], total: 0, page: 1, limit: 5, totalPages: 0 }));
export const getAudio = vi.fn(() => Promise.resolve({ data: {} }));
export const listAudioVoices = vi.fn(() => Promise.resolve({ data: [], total: 0 }));
export const uploadAudio = vi.fn(() => Promise.resolve({ data: {} }));
export const createTts = vi.fn(() => Promise.resolve({ data: {} }));
export const previewTts = vi.fn(() => Promise.resolve(new Blob()));
export const deleteAudio = vi.fn(() => Promise.resolve({ data: { id: 0, deleted: true } }));
export const listRecordings = vi.fn(() => Promise.resolve({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }));
export const getRecording = vi.fn(() => Promise.resolve({ data: {} }));
export const deleteRecording = vi.fn(() => Promise.resolve({ data: { id: 0, deleted: true } }));
export const listExtensions = vi.fn(() => Promise.resolve({ data: [], total: 0 }));
export const createExtension = vi.fn(() => Promise.resolve({ data: {} }));
export const updateExtension = vi.fn(() => Promise.resolve({ data: {} }));
export const deleteExtension = vi.fn(() => Promise.resolve({ data: { id: 0, deleted: true } }));
export const listInboundRoutes = vi.fn(() => Promise.resolve({ data: [], total: 0 }));
export const createInboundRoute = vi.fn(() => Promise.resolve({ data: {} }));
export const updateInboundRoute = vi.fn(() => Promise.resolve({ data: {} }));
export const deleteInboundRoute = vi.fn(() => Promise.resolve({ data: { id: 0, deleted: true } }));
export const getHostConfig = vi.fn(() => Promise.resolve({ hostIp: '127.0.0.1', sipPort: 5060 }));
export const listTrunks = vi.fn(() => Promise.resolve({ data: [], total: 0 }));
export const createTrunk = vi.fn(() => Promise.resolve({ data: {} }));
export const updateTrunk = vi.fn(() => Promise.resolve({ data: {} }));
export const deleteTrunk = vi.fn(() => Promise.resolve());
export const testTrunk = vi.fn(() => Promise.resolve({ status: 'reachable', rtt_ms: 10, message: 'OK' }));

export function resetMocks() {
  vi.clearAllMocks();
}

vi.mock('../../lib/api', () => ({
  listFlows,
  getFlow,
  getFlowBreadcrumb,
  getFlowTree,
  createFlow,
  updateFlow,
  deleteFlow,
  listFlowVersions,
  getFlowVersion,
  createFlowVersion,
  restoreFlowVersion,
  listAudio,
  getAudio,
  listAudioVoices,
  uploadAudio,
  createTts,
  previewTts,
  deleteAudio,
  listRecordings,
  getRecording,
  deleteRecording,
  listExtensions,
  createExtension,
  updateExtension,
  deleteExtension,
  listInboundRoutes,
  createInboundRoute,
  updateInboundRoute,
  deleteInboundRoute,
  getHostConfig,
  listTrunks,
  createTrunk,
  updateTrunk,
  deleteTrunk,
  testTrunk,
}));
