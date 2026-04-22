import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import * as api from './api';

vi.mock('axios', () => {
  const mockAxios = {
    create: vi.fn().mockReturnThis(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} } },
  };
  return {
    default: mockAxios,
  };
});

describe('api library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listFlows calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: [], total: 0 } });
    await api.listFlows(1, 10);
    expect(axios.get).toHaveBeenCalledWith('/flows', { params: { page: 1, limit: 10 } });
  });

  it('getFlow calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: {} } });
    await api.getFlow('1');
    expect(axios.get).toHaveBeenCalledWith('/flows/1');
  });

  it('getFlowBreadcrumb calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: [] });
    await api.getFlowBreadcrumb(1);
    expect(axios.get).toHaveBeenCalledWith('/flows/1/breadcrumb');
  });

  it('getFlowTree calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: {} });
    await api.getFlowTree(1);
    expect(axios.get).toHaveBeenCalledWith('/flows/1/tree');
  });

  it('createFlow calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: { data: {} } });
    await api.createFlow({ name: 'Test' } as any);
    expect(axios.post).toHaveBeenCalledWith('/flows', { name: 'Test' });
  });

  it('updateFlow calls correct endpoint', async () => {
    (axios.put as any).mockResolvedValue({ data: { data: {} } });
    await api.updateFlow('1', { name: 'Updated' } as any);
    expect(axios.put).toHaveBeenCalledWith('/flows/1', { name: 'Updated' });
  });

  it('deleteFlow calls correct endpoint', async () => {
    (axios.delete as any).mockResolvedValue({ data: { data: {} } });
    await api.deleteFlow(1);
    expect(axios.delete).toHaveBeenCalledWith('/flows/1');
  });

  it('listFlowVersions calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: [] });
    await api.listFlowVersions(1);
    expect(axios.get).toHaveBeenCalledWith('/flows/1/versions');
  });

  it('getFlowVersion calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: {} });
    await api.getFlowVersion(1, 10);
    expect(axios.get).toHaveBeenCalledWith('/flows/1/versions/10');
  });

  it('createFlowVersion calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: {} });
    await api.createFlowVersion(1, 'v1');
    expect(axios.post).toHaveBeenCalledWith('/flows/1/versions', { message: 'v1' });
  });

  it('restoreFlowVersion calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: { success: true } });
    await api.restoreFlowVersion(1, 10);
    expect(axios.post).toHaveBeenCalledWith('/flows/1/versions/10/restore');
  });

  it('listAudio calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: [], total: 0 } });
    await api.listAudio(1, 5);
    expect(axios.get).toHaveBeenCalledWith('/audio', { params: { page: 1, limit: 5 } });
  });

  it('getAudio calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: {} });
    await api.getAudio(1);
    expect(axios.get).toHaveBeenCalledWith('/audio/1');
  });

  it('listAudioVoices calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: [] });
    await api.listAudioVoices();
    expect(axios.get).toHaveBeenCalledWith('/audio/voices');
  });

  it('uploadAudio calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: { data: {} } });
    const file = new File([''], 'test.wav');
    await api.uploadAudio(file, 'test');
    expect(axios.post).toHaveBeenCalledWith('/audio/upload', expect.any(FormData));
  });

  it('createTts calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: {} });
    await api.createTts({ name: 'n', text: 't', voice: 'v' });
    expect(axios.post).toHaveBeenCalledWith('/audio/tts', { name: 'n', text: 't', voice: 'v' });
  });

  it('previewTts calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: new Blob() });
    await api.previewTts({ text: 't', voice: 'v' });
    expect(axios.post).toHaveBeenCalledWith('/audio/tts/preview', { text: 't', voice: 'v' }, { responseType: 'blob' });
  });

  it('deleteAudio calls correct endpoint', async () => {
    (axios.delete as any).mockResolvedValue({ data: {} });
    await api.deleteAudio(1);
    expect(axios.delete).toHaveBeenCalledWith('/audio/1');
  });

  it('listRecordings calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: [], total: 0 } });
    await api.listRecordings(1, 20);
    expect(axios.get).toHaveBeenCalledWith('/recordings', { params: { page: 1, limit: 20 } });
  });

  it('getRecording calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: {} });
    await api.getRecording(1);
    expect(axios.get).toHaveBeenCalledWith('/recordings/1');
  });

  it('deleteRecording calls correct endpoint', async () => {
    (axios.delete as any).mockResolvedValue({ data: {} });
    await api.deleteRecording(1);
    expect(axios.delete).toHaveBeenCalledWith('/recordings/1');
  });

  it('listExtensions calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: [], total: 0 } });
    await api.listExtensions(10, 0);
    expect(axios.get).toHaveBeenCalledWith('/extensions', { params: { limit: 10, offset: 0 } });
  });

  it('createExtension calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({
      data: {
        data: {
          id: 1,
          username: 'u',
          transportType: 'sip',
        },
      },
    });
    await api.createExtension({ username: 'u', password: 'p' });
    expect(axios.post).toHaveBeenCalledWith('/extensions', { username: 'u', password: 'p' });
  });

  it('updateExtension calls correct endpoint', async () => {
    (axios.put as any).mockResolvedValue({
      data: {
        data: {
          id: 1,
          username: 'u',
          transportType: 'sip',
        },
      },
    });
    await api.updateExtension(1, { displayName: 'n' });
    expect(axios.put).toHaveBeenCalledWith('/extensions/1', { displayName: 'n' });
  });

  it('deleteExtension calls correct endpoint', async () => {
    (axios.delete as any).mockResolvedValue({ data: {} });
    await api.deleteExtension(1);
    expect(axios.delete).toHaveBeenCalledWith('/extensions/1');
  });

  it('listInboundRoutes calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: [], total: 0 } });
    await api.listInboundRoutes('123', 10, 0);
    expect(axios.get).toHaveBeenCalledWith('/inbound-routes', { params: { did: '123', limit: 10, offset: 0 } });
  });

  it('createInboundRoute calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: {} });
    await api.createInboundRoute({ did: '1', flowId: 1 });
    expect(axios.post).toHaveBeenCalledWith('/inbound-routes', { did: '1', flowId: 1 });
  });

  it('updateInboundRoute calls correct endpoint', async () => {
    (axios.put as any).mockResolvedValue({ data: {} });
    await api.updateInboundRoute(1, { did: '2' });
    expect(axios.put).toHaveBeenCalledWith('/inbound-routes/1', { did: '2' });
  });

  it('deleteInboundRoute calls correct endpoint', async () => {
    (axios.delete as any).mockResolvedValue({ data: {} });
    await api.deleteInboundRoute(1);
    expect(axios.delete).toHaveBeenCalledWith('/inbound-routes/1');
  });

  it('getHostConfig calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { hostIp: '1' } });
    await api.getHostConfig();
    expect(axios.get).toHaveBeenCalledWith('/config/host');
  });

  it('listTrunks calls correct endpoint', async () => {
    (axios.get as any).mockResolvedValue({ data: { data: [], total: 0 } });
    await api.listTrunks(10, 0);
    expect(axios.get).toHaveBeenCalledWith('/trunks', { params: { limit: 10, offset: 0 } });
  });

  it('createTrunk calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: {} });
    await api.createTrunk({ name: 't', host: 'h' });
    expect(axios.post).toHaveBeenCalledWith('/trunks', { name: 't', host: 'h' });
  });

  it('updateTrunk calls correct endpoint', async () => {
    (axios.put as any).mockResolvedValue({ data: {} });
    await api.updateTrunk(1, { name: 'n' });
    expect(axios.put).toHaveBeenCalledWith('/trunks/1', { name: 'n' });
  });

  it('deleteTrunk calls correct endpoint', async () => {
    (axios.delete as any).mockResolvedValue({ data: {} });
    await api.deleteTrunk(1);
    expect(axios.delete).toHaveBeenCalledWith('/trunks/1');
  });

  it('testTrunk calls correct endpoint', async () => {
    (axios.post as any).mockResolvedValue({ data: {} });
    await api.testTrunk(1);
    expect(axios.post).toHaveBeenCalledWith('/trunks/1/test');
  });

  it('diagnostics API helpers call correct endpoints', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: { ari: { connected: true } } });
    (axios.post as any).mockResolvedValueOnce({ data: { trunkId: 1 } });
    (axios.post as any).mockResolvedValueOnce({ data: { data: [] } });
    (axios.get as any).mockResolvedValueOnce({ data: { data: [] } });
    (axios.get as any).mockResolvedValueOnce({ data: { data: [] } });
    (axios.get as any).mockResolvedValueOnce({ data: { data: [], total: 0, page: 1, limit: 50 } });
    (axios.get as any).mockResolvedValueOnce({ data: [] });

    await api.getDiagnosticsHealth();
    await api.testDiagnosticsTrunk(1);
    await api.testAllDiagnosticsTrunks();
    await api.getDiagnosticsRegistrations();
    await api.getDiagnosticsFailures(20, 5);
    await api.getDiagnosticsSipMessages(1, 50, 'call-1');
    await api.getDiagnosticsSipMessagesByCallId('call/1');

    expect(axios.get).toHaveBeenCalledWith('/diagnostics/health');
    expect(axios.post).toHaveBeenCalledWith('/diagnostics/trunks/1/test');
    expect(axios.post).toHaveBeenCalledWith('/diagnostics/trunks/test-all');
    expect(axios.get).toHaveBeenCalledWith('/diagnostics/registrations');
    expect(axios.get).toHaveBeenCalledWith('/diagnostics/failures', { params: { limit: 20, offset: 5 } });
    expect(axios.get).toHaveBeenCalledWith('/diagnostics/sip-messages', { params: { page: 1, limit: 50, callId: 'call-1' } });
    expect(axios.get).toHaveBeenCalledWith('/diagnostics/sip-messages/call%2F1');
  });

  it('template and call-log helpers call correct endpoints', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: { data: [] } });
    (axios.post as any).mockResolvedValueOnce({ data: { data: { id: 1, name: 'x' } } });
    (axios.get as any).mockResolvedValueOnce({ data: { data: [], total: 0, page: 1, limit: 10 } });
    (axios.get as any).mockResolvedValueOnce({ data: { callUuid: 'abc', nodes: [] } });
    (axios.get as any).mockResolvedValueOnce({ data: { callId: 'abc', mos: 4.1 } });

    await api.listTemplates();
    await api.importTemplate(1);
    await api.listCallLogs({ page: 1, limit: 10, search: '1001' });
    await api.getCallTrace('abc/123');
    await api.getCallQuality('abc/123');

    expect(axios.get).toHaveBeenCalledWith('/templates');
    expect(axios.post).toHaveBeenCalledWith('/templates/1/import');
    expect(axios.get).toHaveBeenCalledWith('/call-logs', { params: { page: 1, limit: 10, search: '1001' } });
    expect(axios.get).toHaveBeenCalledWith('/call-logs/abc%2F123/trace');
    expect(axios.get).toHaveBeenCalledWith('/quality/abc%2F123');
  });

  it('operator/contact/queue helpers call correct endpoints', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: {
        data: [{ id: 1, name: 'op', extension: { id: 7, transportType: '' }, contactNumber: null }],
      },
    });
    (axios.post as any).mockResolvedValueOnce({ data: { data: { id: 1 } } });
    (axios.put as any).mockResolvedValueOnce({ data: { data: { id: 1 } } });
    (axios.delete as any).mockResolvedValueOnce({ data: {} });
    (axios.get as any).mockResolvedValueOnce({ data: { data: [] } });
    (axios.post as any).mockResolvedValueOnce({ data: { data: { id: 1 } } });
    (axios.delete as any).mockResolvedValueOnce({ data: {} });
    (axios.get as any).mockResolvedValueOnce({ data: { data: [] } });
    (axios.post as any).mockResolvedValueOnce({ data: { data: { id: 1 } } });
    (axios.delete as any).mockResolvedValueOnce({ data: {} });

    const operators = await api.listOperators();
    await api.createOperator({ name: 'op', extension_id: 1 });
    await api.updateOperator(1, { name: 'op2' });
    await api.deleteOperator(1);
    await api.getContactNumbers();
    await api.createContactNumber({ label: 'sales', number: '123' });
    await api.deleteContactNumber(1);
    await api.listQueues();
    await api.createQueue({ name: 'q1' });
    await api.deleteQueue(1);

    expect(operators.data[0]?.extension?.transportType).toBe('sip');
    expect(axios.post).toHaveBeenCalledWith('/operators', { name: 'op', extension_id: 1 });
    expect(axios.put).toHaveBeenCalledWith('/operators/1', { name: 'op2' });
    expect(axios.delete).toHaveBeenCalledWith('/operators/1');
    expect(axios.get).toHaveBeenCalledWith('/contact-numbers');
    expect(axios.post).toHaveBeenCalledWith('/contact-numbers', { label: 'sales', number: '123' });
    expect(axios.delete).toHaveBeenCalledWith('/contact-numbers/1');
    expect(axios.get).toHaveBeenCalledWith('/queues');
    expect(axios.post).toHaveBeenCalledWith('/queues', { name: 'q1' });
    expect(axios.delete).toHaveBeenCalledWith('/queues/1');
  });
});
