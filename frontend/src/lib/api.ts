import axios from 'axios';
import type {
  AudioFileItem,
  AudioVoiceItem,
  DiagnosticsFailureItem,
  DiagnosticsSystemHealth,
  ExtensionItem,
  FlowBreadcrumbItem,
  FlowDetail,
  FlowSummary,
  FlowTree,
  FlowVersionDetail,
  FlowVersionSummary,
  InboundRouteItem,
  OperatorItem,
  QueueItem,
  RecordingItem,
  TemplateItem,
  CallLogItem,
  CallQuality,
  CallTraceResponse,
  AsteriskLogsResponse,
  ContactNumber,
  SipMessage,
  SipPacket,
  SipRegistrationItem,
  SipTrunkItem,
  TrunkDiagnosticsResult,
  TrunkTestResult,
  PreflightRun,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE,
});

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FlowDetailResponse {
  data: FlowDetail;
}

export interface FlowVersionsResponse {
  data: FlowVersionSummary[];
}

export interface FlowBreadcrumbResponse {
  data: FlowBreadcrumbItem[];
}

export interface FlowTreeResponse {
  data: FlowTree;
}

export interface FlowVersionDetailResponse {
  data: FlowVersionDetail;
}

export interface DeleteFlowResponse {
  data: {
    id: number;
    deleted: true;
  };
}

export interface SaveFlowPayload {
  name: string;
  description?: string;
  slug?: string;
  versionMessage?: string;
  nodes: Array<{
    nodeKey: string;
    type: string;
    label?: string;
    positionX?: number;
    positionY?: number;
    config?: Record<string, unknown>;
    groupId?: string | null;
    subflowId?: number | null;
  }>;
  edges: Array<{
    sourceNodeKey: string;
    targetNodeKey: string;
    branchKey?: string;
    condition?: string | null;
  }>;
}

export interface AudioDetailResponse {
  data: AudioFileItem;
}

export interface AudioVoicesResponse {
  data: AudioVoiceItem[];
  total: number;
}

export interface RecordingDetailResponse {
  data: RecordingItem;
}

export interface ListResponse<T> {
  data: T[];
  total: number;
}

export interface DetailResponse<T> {
  data: T;
}

export interface HostConfigResponse {
  hostIp: string;
  sipPort: number;
}

export async function listFlows(page = 1, limit = 5): Promise<PaginatedResponse<FlowSummary>> {
  const response = await api.get<PaginatedResponse<FlowSummary>>('/flows', { params: { page, limit } });
  return response.data;
}

export async function getFlow(id: string): Promise<FlowDetailResponse> {
  const response = await api.get<FlowDetailResponse>(`/flows/${id}`);
  return response.data;
}

export async function getFlowBreadcrumb(id: number): Promise<FlowBreadcrumbResponse> {
  const response = await api.get<FlowBreadcrumbResponse>(`/flows/${id}/breadcrumb`);
  return response.data;
}

export async function getFlowTree(id: number): Promise<FlowTreeResponse> {
  const response = await api.get<FlowTreeResponse>(`/flows/${id}/tree`);
  return response.data;
}

export async function createFlow(payload: SaveFlowPayload): Promise<FlowDetailResponse> {
  const response = await api.post<FlowDetailResponse>('/flows', payload);
  return response.data;
}

export async function updateFlow(id: string, payload: SaveFlowPayload): Promise<FlowDetailResponse> {
  const response = await api.put<FlowDetailResponse>(`/flows/${id}`, payload);
  return response.data;
}

export async function deleteFlow(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/flows/${id}`);
  return response.data;
}

export async function listFlowVersions(id: number): Promise<FlowVersionsResponse> {
  const response = await api.get<FlowVersionsResponse>(`/flows/${id}/versions`);
  return response.data;
}

export async function getFlowVersion(id: number, versionId: number): Promise<FlowVersionDetailResponse> {
  const response = await api.get<FlowVersionDetailResponse>(`/flows/${id}/versions/${versionId}`);
  return response.data;
}

export async function createFlowVersion(id: number, message: string): Promise<FlowVersionDetailResponse | { data: FlowVersionSummary }> {
  const response = await api.post<FlowVersionDetailResponse | { data: FlowVersionSummary }>(`/flows/${id}/versions`, { message });
  return response.data;
}

export async function restoreFlowVersion(id: number, versionId: number): Promise<{ data: { success: true } }> {
  const response = await api.post<{ data: { success: true } }>(`/flows/${id}/versions/${versionId}/restore`);
  return response.data;
}

export async function listAudio(page = 1, limit = 5): Promise<PaginatedResponse<AudioFileItem>> {
  const response = await api.get<PaginatedResponse<AudioFileItem>>('/audio', { params: { page, limit } });
  return response.data;
}

export async function listAllAudio(): Promise<PaginatedResponse<AudioFileItem>> {
  const response = await api.get<PaginatedResponse<AudioFileItem>>('/audio', { params: { page: 1, limit: 1000 } });
  return response.data;
}

export async function getAudio(id: number): Promise<AudioDetailResponse> {
  const response = await api.get<AudioDetailResponse>(`/audio/${id}`);
  return response.data;
}

export async function listAudioVoices(): Promise<AudioVoicesResponse> {
  const response = await api.get<AudioVoicesResponse>('/audio/voices');
  return response.data;
}

export async function uploadAudio(file: File, name?: string): Promise<AudioDetailResponse> {
  const form = new FormData();
  form.append('file', file);
  if (name) form.append('name', name);
  const response = await api.post<AudioDetailResponse>('/audio/upload', form);
  return response.data;
}

export async function createTts(payload: { name: string; text: string; voice: string; speed?: number }): Promise<AudioDetailResponse> {
  const response = await api.post<AudioDetailResponse>('/audio/tts', payload);
  return response.data;
}

export async function previewTts(payload: { text: string; voice: string; speed?: number }): Promise<Blob> {
  const response = await api.post('/audio/tts/preview', payload, { responseType: 'blob' });
  return response.data as Blob;
}

export async function deleteAudio(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/audio/${id}`);
  return response.data;
}

export async function listRecordings(page = 1, limit = 20): Promise<PaginatedResponse<RecordingItem>> {
  const response = await api.get<PaginatedResponse<RecordingItem>>('/recordings', { params: { page, limit } });
  return response.data;
}

export async function getRecording(id: number): Promise<RecordingDetailResponse> {
  const response = await api.get<RecordingDetailResponse>(`/recordings/${id}`);
  return response.data;
}

export async function deleteRecording(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/recordings/${id}`);
  return response.data;
}

export async function listExtensions(limit = 20, offset = 0): Promise<ListResponse<ExtensionItem>> {
  const response = await api.get<ListResponse<ExtensionItem>>('/extensions', { params: { limit, offset } });
  return {
    ...response.data,
    data: response.data.data.map((item) => ({
      ...item,
      transportType: item.transportType || 'sip',
    })),
  };
}

export async function createExtension(payload: { username: string; password: string; displayName?: string; transportType?: 'sip' | 'webrtc'; transport_type?: 'sip' | 'webrtc' }): Promise<DetailResponse<ExtensionItem>> {
  const response = await api.post<DetailResponse<ExtensionItem>>('/extensions', payload);
  return {
    ...response.data,
    data: {
      ...response.data.data,
      transportType: response.data.data.transportType || 'sip',
    },
  };
}

export async function updateExtension(id: number, payload: { username?: string; password?: string; displayName?: string; transportType?: 'sip' | 'webrtc'; transport_type?: 'sip' | 'webrtc' }): Promise<DetailResponse<ExtensionItem>> {
  const response = await api.put<DetailResponse<ExtensionItem>>(`/extensions/${id}`, payload);
  return {
    ...response.data,
    data: {
      ...response.data.data,
      transportType: response.data.data.transportType || 'sip',
    },
  };
}

export async function deleteExtension(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/extensions/${id}`);
  return response.data;
}

export async function listInboundRoutes(did?: string, limit = 20, offset = 0): Promise<ListResponse<InboundRouteItem>> {
  const params: Record<string, string | number> = { limit, offset };
  if (did) params.did = did;
  const response = await api.get<ListResponse<InboundRouteItem>>('/inbound-routes', { params });
  return response.data;
}

export async function createInboundRoute(payload: { did: string; flowId: number; label?: string }): Promise<DetailResponse<InboundRouteItem>> {
  const response = await api.post<DetailResponse<InboundRouteItem>>('/inbound-routes', payload);
  return response.data;
}

export async function updateInboundRoute(id: number, payload: { did?: string; flowId?: number; label?: string }): Promise<DetailResponse<InboundRouteItem>> {
  const response = await api.put<DetailResponse<InboundRouteItem>>(`/inbound-routes/${id}`, payload);
  return response.data;
}

export async function deleteInboundRoute(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/inbound-routes/${id}`);
  return response.data;
}

export async function getHostConfig(): Promise<HostConfigResponse> {
  const response = await api.get<HostConfigResponse>('/config/host');
  return response.data;
}

export async function listTrunks(limit = 20, offset = 0): Promise<ListResponse<SipTrunkItem>> {
  const response = await api.get<ListResponse<SipTrunkItem>>('/trunks', { params: { limit, offset } });
  return response.data;
}

export async function createTrunk(payload: {
  name: string;
  providerPreset?: string;
  host: string;
  port?: number;
  username?: string;
  password?: string;
  fromDomain?: string;
  fromUser?: string;
  enabled?: boolean;
}): Promise<DetailResponse<SipTrunkItem>> {
  const response = await api.post<DetailResponse<SipTrunkItem>>('/trunks', payload);
  return response.data;
}

export async function updateTrunk(id: number, payload: {
  name?: string;
  providerPreset?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  fromDomain?: string;
  fromUser?: string;
  enabled?: boolean;
}): Promise<DetailResponse<SipTrunkItem>> {
  const response = await api.put<DetailResponse<SipTrunkItem>>(`/trunks/${id}`, payload);
  return response.data;
}

export async function deleteTrunk(id: number): Promise<void> {
  await api.delete(`/trunks/${id}`);
}

export async function testTrunk(id: number): Promise<TrunkTestResult> {
  const response = await api.post<TrunkTestResult>(`/trunks/${id}/test`);
  return response.data;
}

export async function getDiagnosticsHealth(): Promise<DiagnosticsSystemHealth> {
  const response = await api.get<DiagnosticsSystemHealth>('/diagnostics/health');
  return response.data;
}

export async function testDiagnosticsTrunk(id: number): Promise<TrunkDiagnosticsResult> {
  const response = await api.post<TrunkDiagnosticsResult>(`/diagnostics/trunks/${id}/test`);
  return response.data;
}

export async function testAllDiagnosticsTrunks(): Promise<ListResponse<TrunkDiagnosticsResult>> {
  const response = await api.post<ListResponse<TrunkDiagnosticsResult>>('/diagnostics/trunks/test-all');
  return response.data;
}

export async function getDiagnosticsRegistrations(): Promise<ListResponse<SipRegistrationItem>> {
  const response = await api.get<ListResponse<SipRegistrationItem>>('/diagnostics/registrations');
  return response.data;
}

export async function getDiagnosticsFailures(limit = 20, offset = 0): Promise<ListResponse<DiagnosticsFailureItem>> {
  const response = await api.get<ListResponse<DiagnosticsFailureItem>>('/diagnostics/failures', {
    params: { limit, offset },
  });
  return response.data;
}

export async function getDiagnosticsSipMessages(page = 1, limit = 50, callId?: string): Promise<{ data: SipMessage[]; total: number; page: number; limit: number }> {
  const response = await api.get<{ data: SipMessage[]; total: number; page: number; limit: number }>('/diagnostics/sip-messages', {
    params: { page, limit, callId },
  });
  return response.data;
}

export async function getDiagnosticsSipMessagesByCallId(callId: string): Promise<SipMessage[]> {
  const response = await api.get<SipMessage[]>(`/diagnostics/sip-messages/${encodeURIComponent(callId)}`);
  return response.data;
}

export async function runPreflightChecks(): Promise<PreflightRun> {
  const response = await api.post<PreflightRun>('/preflight/run');
  return response.data;
}

export async function getPreflightHistory(): Promise<PreflightRun[]> {
  const response = await api.get<PreflightRun[]>('/preflight/history');
  return response.data;
}

export async function getCapturePackets(callId: string): Promise<SipPacket[]> {
  try {
    const res = await fetch(`${API_BASE}/capture/packets/${encodeURIComponent(callId)}`);
    if (!res.ok) {
      return [];
    }
    return await res.json() as SipPacket[];
  } catch {
    return [];
  }
}

export async function exportCaptureDialog(callId: string): Promise<Blob> {
  const response = await api.get(`/capture/export/dialog/${encodeURIComponent(callId)}`, {
    responseType: 'blob',
  });
  return response.data as Blob;
}

export async function exportCaptureBulk(params: {
  method?: string;
  callId?: string;
  endpoint?: string;
  from?: string;
  to?: string;
}): Promise<Blob> {
  const response = await api.get('/capture/export/bulk', {
    params,
    responseType: 'blob',
  });
  return response.data as Blob;
}

export async function listTemplates(): Promise<ListResponse<TemplateItem>> {
  const response = await api.get<ListResponse<TemplateItem>>('/templates');
  return response.data;
}

export async function importTemplate(id: number): Promise<DetailResponse<{ id: number; name: string }>> {
  const response = await api.post<DetailResponse<{ id: number; name: string }>>(`/templates/${id}/import`);
  return response.data;
}

export async function listCallLogs(params: {
  page?: number;
  limit?: number;
  search?: string;
  endReason?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<PaginatedResponse<CallLogItem>> {
  const response = await api.get<PaginatedResponse<CallLogItem>>('/call-logs', { params });
  return response.data;
}

export async function getCallTrace(callUuid: string): Promise<CallTraceResponse> {
  const response = await api.get<CallTraceResponse>(`/call-logs/${encodeURIComponent(callUuid)}/trace`);
  return response.data;
}

export async function listAsteriskLogs(params: {
  level?: 'all' | 'error' | 'warning' | 'notice' | 'verbose';
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AsteriskLogsResponse> {
  const response = await api.get<AsteriskLogsResponse>('/asterisk/logs', { params });
  return response.data;
}

export async function getCallQuality(callId: string): Promise<CallQuality | null> {
  try {
    const response = await api.get<CallQuality>(`/quality/${encodeURIComponent(callId)}`);
    return response.data;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return null;
    }
    return null;
  }
}

export async function listOperators(page = 1, limit = 10): Promise<PaginatedResponse<OperatorItem>> {
  const response = await api.get<{ data: OperatorItem[]; total: number; page: number; limit: number }>('/operators', {
    params: { page, limit },
  });
  const totalPages = Math.max(1, Math.ceil(response.data.total / response.data.limit));
  return {
    ...response.data,
    totalPages,
    data: response.data.data.map((item) => ({
      ...item,
      extension: item.extension
        ? { ...item.extension, transportType: item.extension.transportType || 'sip' }
        : undefined,
      contactNumber: item.contactNumber || undefined,
    })),
  };
}

export async function createOperator(payload: {
  name: string;
  extension_id?: number;
  contact_number_id?: number;
  pin?: string;
}): Promise<DetailResponse<OperatorItem>> {
  const response = await api.post<DetailResponse<OperatorItem>>('/operators', payload);
  return response.data;
}

export async function updateOperator(id: number, payload: {
  name?: string;
  extension_id?: number;
  contact_number_id?: number;
  pin?: string;
}): Promise<DetailResponse<OperatorItem>> {
  const response = await api.put<DetailResponse<OperatorItem>>(`/operators/${id}`, payload);
  return response.data;
}

export async function getContactNumbers(page = 1, limit = 10): Promise<PaginatedResponse<ContactNumber>> {
  const response = await api.get<{ data: ContactNumber[]; total: number; page: number; limit: number }>('/contact-numbers', {
    params: { page, limit },
  });
  return {
    ...response.data,
    totalPages: Math.max(1, Math.ceil(response.data.total / response.data.limit)),
  };
}

export async function createContactNumber(data: {
  label: string;
  number: string;
  trunk_id?: number;
  notes?: string;
}): Promise<DetailResponse<ContactNumber>> {
  const response = await api.post<DetailResponse<ContactNumber>>('/contact-numbers', data);
  return response.data;
}

export async function updateContactNumber(id: number, data: {
  label?: string;
  number?: string;
  trunk_id?: number | null;
  notes?: string;
}): Promise<DetailResponse<ContactNumber>> {
  const response = await api.patch<DetailResponse<ContactNumber>>(`/contact-numbers/${id}`, data);
  return response.data;
}

export async function deleteContactNumber(id: number): Promise<void> {
  await api.delete(`/contact-numbers/${id}`);
}


export async function deleteOperator(id: number): Promise<void> {
  await api.delete(`/operators/${id}`);
}

export async function listQueues(page = 1, limit = 10): Promise<PaginatedResponse<QueueItem>> {
  const response = await api.get<{ data: QueueItem[]; total: number; page: number; limit: number }>('/queues', {
    params: { page, limit },
  });
  return {
    ...response.data,
    totalPages: Math.max(1, Math.ceil(response.data.total / response.data.limit)),
  };
}

export async function createQueue(payload: {
  name: string;
  wait_audio_file_id?: number | null;
  max_wait_seconds?: number;
  pin_retry_attempts?: number;
  operator_ids?: number[];
}): Promise<DetailResponse<QueueItem>> {
  const response = await api.post<DetailResponse<QueueItem>>('/queues', payload);
  return response.data;
}

export async function updateQueue(id: number, payload: {
  name?: string;
  wait_audio_file_id?: number | null;
  max_wait_seconds?: number;
  pin_retry_attempts?: number;
  operator_ids?: number[];
}): Promise<DetailResponse<QueueItem>> {
  const response = await api.patch<DetailResponse<QueueItem>>(`/queues/${id}`, payload);
  return response.data;
}

export async function deleteQueue(id: number): Promise<void> {
  await api.delete(`/queues/${id}`);
}
