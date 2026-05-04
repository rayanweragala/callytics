import axios from 'axios';
import type {
  AudioFileItem,
  AudioVoiceItem,
  DiagnosticsFailureItem,
  DiagnosticsSystemHealth,
  DiagnosticsResourcesResponse,
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
  RelayConfigState,
  TemplateItem,
  CallLogItem,
  CallQuality,
  CallTraceResponse,
  AsteriskLogsResponse,
  ContactNumber,
  SipMessage,
  SipPacket,
  RegistrationHealthResponse,
  SipTrunkItem,
  SystemSettings,
  TrunkDiagnosticsResult,
  TrunkTestResult,
  PreflightRun,
  CampaignItem,
  CampaignContactItem,
  CampaignContactAttemptItem,
  CampaignContactsUploadResult,
  CallbackItem,
  BackupConfig,
  BackupConfigUpdate,
  BackupHistoryItem,
  CreatedVpnPeer,
  FirewallBlockedIp,
  FirewallConfig,
  FirewallConfigUpdate,
  FirewallEventType,
  FirewallFeedEvent,
  FirewallStats,
  RelayGuideStep,
  RelayTunnelStatus,
  VpnPeer,
  VpnStatus,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE,
});

function parseContentDispositionFilename(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const plainMatch = value.match(/filename="([^"]+)"/i) ?? value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || null;
}

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
  autoSave?: boolean;
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
  const response = await api.get<AudioVoicesResponse>('/audio/tts/voices');
  return response.data;
}

export async function uploadAudio(file: File, name?: string): Promise<AudioDetailResponse> {
  const form = new FormData();
  form.append('file', file);
  if (name) form.append('name', name);
  const response = await api.post<AudioDetailResponse>('/audio/upload', form);
  return response.data;
}

export async function createTts(payload: { name: string; text: string; voice: string; speed?: number; pitch?: number; normalizeVolume?: boolean }): Promise<AudioDetailResponse> {
  const response = await api.post<AudioDetailResponse>('/audio/tts', payload);
  return response.data;
}

export async function previewTts(payload: { text: string; voice: string; speed?: number; pitch?: number; normalizeVolume?: boolean }): Promise<Blob> {
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
      vpnOnly: Boolean(item.vpnOnly),
    })),
  };
}

export async function createExtension(payload: { username: string; password: string; displayName?: string; transportType?: 'sip' | 'webrtc'; transport_type?: 'sip' | 'webrtc'; vpnOnly?: boolean }): Promise<DetailResponse<ExtensionItem>> {
  const response = await api.post<DetailResponse<ExtensionItem>>('/extensions', payload);
  return {
    ...response.data,
    data: {
      ...response.data.data,
      transportType: response.data.data.transportType || 'sip',
      vpnOnly: Boolean(response.data.data.vpnOnly),
    },
  };
}

export async function updateExtension(id: number, payload: { username?: string; password?: string; displayName?: string; transportType?: 'sip' | 'webrtc'; transport_type?: 'sip' | 'webrtc'; vpnOnly?: boolean }): Promise<DetailResponse<ExtensionItem>> {
  const response = await api.put<DetailResponse<ExtensionItem>>(`/extensions/${id}`, payload);
  return {
    ...response.data,
    data: {
      ...response.data.data,
      transportType: response.data.data.transportType || 'sip',
      vpnOnly: Boolean(response.data.data.vpnOnly),
    },
  };
}

export async function deleteExtension(id: number): Promise<DeleteFlowResponse> {
  const response = await api.delete<DeleteFlowResponse>(`/extensions/${id}`);
  return response.data;
}

export async function getExtensionQrContent(id: number): Promise<{ data: { content: string } }> {
  const response = await api.get<{ data: { content: string } }>(`/extensions/${id}/qr-content`);
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

export async function getSettings(): Promise<DetailResponse<SystemSettings>> {
  const response = await api.get<DetailResponse<SystemSettings>>('/settings');
  return response.data;
}

export async function updateSettings(payload: {
  default_outbound_trunk_id?: number | null;
  record_outbound_calls?: boolean;
}): Promise<DetailResponse<SystemSettings>> {
  const response = await api.put<DetailResponse<SystemSettings>>('/settings', payload);
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
  dialFormat?: string;
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
  dialFormat?: string;
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

export async function testTrunkOutbound(trunkId: number, number: string, audioFileId?: number | null): Promise<{ testCallId: string }> {
  const response = await api.post<{ testCallId: string }>(`/trunks/${trunkId}/test-outbound`, {
    number,
    audioFileId: audioFileId ?? null,
  });
  return response.data;
}

export async function testTrunkInbound(trunkId: number): Promise<{ testCallId: string }> {
  const response = await api.post<{ testCallId: string }>(`/trunks/${trunkId}/test-inbound`);
  return response.data;
}

export async function getTrunkTestStatus(
  trunkId: number,
  testCallId: string,
): Promise<{ status: 'dialing' | 'answered' | 'completed' | 'failed'; reason: string | null }> {
  const response = await api.get<{ status: 'dialing' | 'answered' | 'completed' | 'failed'; reason: string | null }>(
    `/trunks/${trunkId}/test-call/${encodeURIComponent(testCallId)}/status`,
  );
  return response.data;
}

export async function getDiagnosticsHealth(): Promise<DiagnosticsSystemHealth> {
  const response = await api.get<DiagnosticsSystemHealth>('/diagnostics/health');
  return response.data;
}

export async function getDiagnosticsResources(): Promise<DiagnosticsResourcesResponse> {
  const response = await api.get<DiagnosticsResourcesResponse>('/diagnostics/resources');
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

export async function getDiagnosticsRegistrations(): Promise<RegistrationHealthResponse> {
  const response = await api.get<RegistrationHealthResponse>('/diagnostics/registrations');
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

export async function getPreflightHistory(page = 1, limit = 10): Promise<PaginatedResponse<PreflightRun>> {
  const response = await api.get<{ data: PreflightRun[]; total: number; page: number; limit: number }>('/preflight/history', {
    params: { page, limit },
  });
  const payload = response.data;
  const totalPages = payload.total > 0 ? Math.ceil(payload.total / payload.limit) : 1;
  return {
    data: payload.data,
    total: payload.total,
    page: payload.page,
    limit: payload.limit,
    totalPages,
  };
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

export async function listCampaigns(limit = 25, offset = 0): Promise<{ campaigns: CampaignItem[]; total: number }> {
  const response = await api.get<{ campaigns: CampaignItem[]; total: number }>('/campaigns', { params: { limit, offset } });
  return response.data;
}

export async function getCampaign(id: number): Promise<CampaignItem> {
  const response = await api.get<CampaignItem>(`/campaigns/${id}`);
  return response.data;
}

export async function createCampaign(payload: {
  name: string;
  flowId?: number | null;
  trunkId?: number | null;
  callerId?: string | null;
  defaultCountry?: string;
  scheduledAt?: string | null;
  maxConcurrent: number;
  maxRetries: number;
  retryIntervalMinutes: number;
}): Promise<CampaignItem> {
  const response = await api.post<CampaignItem>('/campaigns', payload);
  return response.data;
}

export async function updateCampaign(id: number, payload: {
  name?: string;
  flowId?: number | null;
  trunkId?: number | null;
  callerId?: string | null;
  defaultCountry?: string;
  scheduledAt?: string | null;
  maxConcurrent?: number;
  maxRetries?: number;
  retryIntervalMinutes?: number;
}): Promise<CampaignItem> {
  const response = await api.patch<CampaignItem>(`/campaigns/${id}`, payload);
  return response.data;
}

export async function deleteCampaign(id: number): Promise<{ ok: true }> {
  const response = await api.delete<{ ok: true }>(`/campaigns/${id}`);
  return response.data;
}

export async function scheduleCampaign(id: number): Promise<CampaignItem> {
  const response = await api.post<CampaignItem>(`/campaigns/${id}/schedule`);
  return response.data;
}

export async function stopCampaign(id: number): Promise<CampaignItem> {
  const response = await api.post<CampaignItem>(`/campaigns/${id}/stop`);
  return response.data;
}

export async function uploadCampaignContacts(id: number, file: File): Promise<CampaignContactsUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post<CampaignContactsUploadResult>(`/campaigns/${id}/contacts/upload`, form);
  return response.data;
}

export async function listCampaignContacts(id: number, params: { limit?: number; offset?: number; status?: string }): Promise<{ contacts: CampaignContactItem[]; total: number }> {
  const response = await api.get<{ contacts: CampaignContactItem[]; total: number }>(`/campaigns/${id}/contacts`, { params });
  return response.data;
}

export async function listCampaignContactAttempts(campaignId: number, contactId: number): Promise<CampaignContactAttemptItem[]> {
  const response = await api.get<CampaignContactAttemptItem[]>(`/campaigns/${campaignId}/contacts/${contactId}/attempts`);
  return response.data;
}

export async function getCampaignProgress(id: number): Promise<{
  status: string;
  totalContacts: number;
  dialedCount: number;
  answeredCount: number;
  failedCount: number;
  pendingCount: number;
  activeCallCount: number;
}> {
  const response = await api.get(`/campaigns/${id}/progress`);
  return response.data;
}

export async function listCallLogs(params: {
  page?: number;
  limit?: number;
  search?: string;
  endReason?: string;
  dateFrom?: string;
  dateTo?: string;
  direction?: string;
  callLogId?: number;
}): Promise<PaginatedResponse<CallLogItem>> {
  const response = await api.get<PaginatedResponse<CallLogItem>>('/call-logs', { params });
  return response.data;
}

export async function getCallTrace(callUuid: string): Promise<CallTraceResponse> {
  const response = await api.get<CallTraceResponse>(`/call-logs/${encodeURIComponent(callUuid)}/trace`);
  return response.data;
}

export async function exportCallLogsCsv(params: {
  search?: string;
  endReason?: string;
  dateFrom?: string;
  dateTo?: string;
  direction?: string;
}): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get('/call-logs/export', {
    params,
    responseType: 'blob',
  });
  const disposition = String(response.headers?.['content-disposition'] || '');
  const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const filename = match?.[1]?.trim() || 'cdr-export.csv';
  return { blob: response.data as Blob, filename };
}

export async function listAsteriskLogs(params: {
  level?: 'all' | 'error' | 'warning' | 'notice' | 'verbose';
  search?: string;
  hideNoise?: boolean;
  uniqueid?: string;
  from?: string;
  to?: string;
  callerNumber?: string;
  destination?: string;
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
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
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
  callback_number?: string;
  callback_trunk_id?: number;
}): Promise<DetailResponse<OperatorItem>> {
  const response = await api.post<DetailResponse<OperatorItem>>('/operators', payload);
  return response.data;
}

export async function updateOperator(id: number, payload: {
  name?: string;
  extension_id?: number;
  contact_number_id?: number;
  pin?: string;
  callback_number?: string;
  callback_trunk_id?: number;
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
  country?: string;
  trunk_id?: number;
  notes?: string;
}): Promise<DetailResponse<ContactNumber>> {
  const response = await api.post<DetailResponse<ContactNumber>>('/contact-numbers', data);
  return response.data;
}

export async function updateContactNumber(id: number, data: {
  label?: string;
  number?: string;
  country?: string;
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

export async function listCallbacks(params: {
  page?: number;
  limit?: number;
  status?: string;
}): Promise<PaginatedResponse<CallbackItem>> {
  const response = await api.get<{ data: CallbackItem[]; total: number; page: number; limit: number }>('/callbacks', { params });
  return {
    ...response.data,
    totalPages: Math.max(1, Math.ceil(response.data.total / response.data.limit)),
  };
}

export async function getCallback(id: number): Promise<DetailResponse<CallbackItem>> {
  const response = await api.get<DetailResponse<CallbackItem>>(`/callbacks/${id}`);
  return response.data;
}

export async function executeCallback(id: number): Promise<{ success: true }> {
  const response = await api.post<{ success: true }>(`/callbacks/${id}/execute`);
  return response.data;
}

export async function cancelCallback(id: number): Promise<{ success: true }> {
  const response = await api.post<{ success: true }>(`/callbacks/${id}/cancel`);
  return response.data;
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

export async function createBackup(payload: { includeRecordings: boolean }): Promise<DetailResponse<BackupHistoryItem>> {
  const response = await api.post<DetailResponse<BackupHistoryItem>>('/backup', payload);
  return response.data;
}

export async function listBackups(page = 1, limit = 10): Promise<PaginatedResponse<BackupHistoryItem>> {
  const response = await api.get<PaginatedResponse<BackupHistoryItem>>('/backup', { params: { page, limit } });
  return response.data;
}

export async function deleteBackup(id: number): Promise<void> {
  await api.delete(`/backup/${id}`);
}

export function getBackupDownloadUrl(id: number): string {
  return `${API_BASE}/backup/${id}/download`;
}

export async function fetchBackupArchive(id: number): Promise<{ blob: Blob; filename: string }> {
  const response = await api.get(`/backup/${id}/download`, { responseType: 'blob' });
  const filename = parseContentDispositionFilename(response.headers['content-disposition']) || `backup-${id}.tar.gz`;
  return { blob: response.data as Blob, filename };
}

export async function restoreBackupArchive(file: File, options: { restoreDb: boolean; restoreRecordings: boolean }): Promise<{ success: true }> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<{ success: true }>('/backup/restore', formData, {
    params: options,
  });
  return response.data;
}

export async function getBackupConfig(): Promise<BackupConfig> {
  const response = await api.get<BackupConfig>('/backup/config');
  return response.data;
}

export async function updateBackupConfig(payload: BackupConfigUpdate): Promise<BackupConfig> {
  const response = await api.put<BackupConfig>('/backup/config', payload);
  return response.data;
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

export async function getFirewallConfig(): Promise<FirewallConfig> {
  const response = await api.get<FirewallConfig>('/firewall/config');
  return response.data;
}

export async function updateFirewallConfig(payload: FirewallConfigUpdate): Promise<FirewallConfig> {
  const response = await api.put<FirewallConfig>('/firewall/config', payload);
  return response.data;
}

export async function listFirewallBlockedIps(): Promise<ListResponse<FirewallBlockedIp>> {
  const response = await api.get<ListResponse<FirewallBlockedIp>>('/firewall/blocked-ips');
  return response.data;
}

export async function unblockFirewallIp(ip: string): Promise<void> {
  await api.delete(`/firewall/blocked-ips/${encodeURIComponent(ip)}`);
}

export async function whitelistFirewallIp(ip: string): Promise<FirewallBlockedIp> {
  const response = await api.post<FirewallBlockedIp>('/firewall/whitelist', { ip });
  return response.data;
}

export async function removeFirewallWhitelist(ip: string): Promise<void> {
  await api.delete(`/firewall/whitelist/${encodeURIComponent(ip)}`);
}

export async function listFirewallEvents(page = 1, limit = 50, eventType?: FirewallEventType): Promise<PaginatedResponse<FirewallFeedEvent>> {
  const response = await api.get<PaginatedResponse<FirewallFeedEvent>>('/firewall/events', { params: { page, limit, eventType } });
  return response.data;
}

export async function getFirewallStats(): Promise<FirewallStats> {
  const response = await api.get<FirewallStats>('/firewall/stats');
  return response.data;
}

export async function getVpnStatus(): Promise<VpnStatus> {
  const response = await api.get<VpnStatus>('/vpn/status');
  return response.data;
}

export async function listVpnPeers(): Promise<VpnPeer[]> {
  const response = await api.get<VpnPeer[]>('/vpn/peers');
  return response.data;
}

export async function createVpnPeer(name: string): Promise<DetailResponse<CreatedVpnPeer>> {
  const response = await api.post<DetailResponse<CreatedVpnPeer>>('/vpn/peers', { name });
  return response.data;
}

export async function revokeVpnPeer(id: number): Promise<void> {
  await api.delete(`/vpn/peers/${id}`);
}

export async function removeVpn(): Promise<{ success: true }> {
  const response = await api.delete<{ success: true }>('/vpn');
  return response.data;
}

export async function getVpnPeerConfig(id: number): Promise<string> {
  const response = await api.get<string>(`/vpn/peers/${id}/config`, { responseType: 'text' });
  return response.data;
}

export function getVpnPeerQrUrl(id: number): string {
  return `${API_BASE}/vpn/peers/${id}/qr`;
}

export async function getVpnRelayGuide(): Promise<{ data: RelayGuideStep[] }> {
  const response = await api.get<{ data: RelayGuideStep[] }>('/vpn/relay-guide');
  return response.data;
}

export async function createVpnRelayConfig(payload: { vpsPublicKey: string; vpsPublicIp: string }): Promise<{ config: string }> {
  const response = await api.post<{ config: string }>('/vpn/relay-config', payload);
  return response.data;
}

export async function activateVpnRelayTunnel(config: string): Promise<{ accepted: true }> {
  const response = await api.post<{ accepted: true }>('/vpn/relay-activate', { config });
  return response.data;
}

export async function deactivateVpnRelayTunnel(): Promise<{ accepted: true }> {
  const response = await api.delete<{ accepted: true }>('/vpn/relay-deactivate');
  return response.data;
}

export async function getVpnRelayStatus(): Promise<RelayTunnelStatus> {
  const response = await api.get<RelayTunnelStatus>('/vpn/relay-status');
  return response.data;
}

export async function getVpnRelayConfig(): Promise<RelayConfigState> {
  const response = await api.get<RelayConfigState>('/vpn/relay-config');
  return response.data;
}
