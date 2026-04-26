import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsPage } from './DiagnosticsPage';
import {
  getDiagnosticsFailures,
  getDiagnosticsHealth,
  getDiagnosticsRegistrations,
  getDiagnosticsSipMessages,
  getDiagnosticsSipMessagesByCallId,
  listTrunks,
} from '../lib/api';

vi.mock('../lib/api', () => ({
  getDiagnosticsHealth: vi.fn(),
  getDiagnosticsRegistrations: vi.fn(),
  listTrunks: vi.fn(),
  getDiagnosticsFailures: vi.fn(),
  getDiagnosticsSipMessages: vi.fn(),
  getDiagnosticsSipMessagesByCallId: vi.fn(),
  testDiagnosticsTrunk: vi.fn(),
  testAllDiagnosticsTrunks: vi.fn(),
}));

vi.mock('../lib/socket', () => ({
  diagnosticsSocket: {
    connected: true,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('DiagnosticsPage Phase 21 drill-down behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getDiagnosticsHealth).mockResolvedValue({
      ari: { connected: true, latencyMs: 8 },
      ami: { connected: true },
      asterisk: { version: '20.0.0', uptimeSeconds: 3600 },
      activeChannels: 2,
      postgres: { reachable: true },
      redis: { reachable: true },
      checkedAt: new Date().toISOString(),
      items: [
        { label: 'ARI', state: 'healthy', detail: '8 ms' },
        { label: 'AMI', state: 'healthy', detail: 'Connected' },
      ],
    } as any);

    vi.mocked(getDiagnosticsRegistrations).mockResolvedValue({ data: [] } as any);
    vi.mocked(listTrunks).mockResolvedValue({ data: [], total: 0 } as any);

    vi.mocked(getDiagnosticsFailures).mockResolvedValue({
      data: [
        {
          id: 10,
          callId: 'fail-call-1',
          callUuid: 'fail-call-1',
          startedAt: '2026-04-21T20:00:05.000Z',
          callerNumber: '1001',
          flowName: 'Main',
          failedNodeType: 'transfer',
          errorMessage: 'Busy Here',
          durationSeconds: 4,
        },
      ],
      total: 1,
    } as any);

    vi.mocked(getDiagnosticsSipMessages).mockResolvedValue({
      data: [
        {
          id: 1,
          callId: null,
          timestamp: '2026-04-21T20:00:01.000Z',
          method: 'INVITE',
          fromUri: 'sip:1000@a.local',
          toUri: 'sip:2000@b.local',
          direction: 'inbound',
          responseCode: null,
          rawMessage: 'INVITE no call id',
          createdAt: null,
        },
        {
          id: 2,
          callId: 'call-1',
          timestamp: '2026-04-21T20:00:02.000Z',
          method: 'INVITE',
          fromUri: 'sip:1001@a.local',
          toUri: 'sip:2001@b.local',
          direction: 'inbound',
          responseCode: null,
          rawMessage: 'INVITE call-1',
          createdAt: null,
        },
        {
          id: 3,
          callId: 'call-2',
          timestamp: '2026-04-21T20:00:03.000Z',
          method: 'BYE',
          fromUri: 'sip:1002@a.local',
          toUri: 'sip:2002@b.local',
          direction: 'outbound',
          responseCode: 486,
          rawMessage: 'BYE call-2',
          createdAt: null,
        },
      ],
      total: 3,
      page: 1,
      limit: 5,
    });

    vi.mocked(getDiagnosticsSipMessagesByCallId).mockImplementation(async (callId: string) => {
      if (callId === 'fail-call-1') {
        return [
          { id: 100, callId, timestamp: '2026-04-21T20:00:01.000Z', method: 'INVITE', fromUri: 'sip:1001@a.local', toUri: 'sip:2001@b.local', direction: 'inbound', responseCode: null, rawMessage: 'invite', createdAt: null },
          { id: 101, callId, timestamp: '2026-04-21T20:00:06.000Z', method: '486', fromUri: 'sip:2001@b.local', toUri: 'sip:1001@a.local', direction: 'outbound', responseCode: 486, rawMessage: 'busy', createdAt: null },
        ] as any;
      }
      return [
        { id: 200, callId, timestamp: '2026-04-21T20:00:00.000Z', method: 'INVITE', fromUri: 'sip:1001@a.local', toUri: 'sip:2001@b.local', direction: 'inbound', responseCode: null, rawMessage: 'invite', createdAt: null },
      ] as any;
    });
  });

  it('Panel D: opens ladder on row click, updates call-id on second click, and shows no-call-id note', async () => {
    const { container } = render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));

    await waitFor(() => expect(screen.getByText('SIP Traffic Inspector')).toBeInTheDocument());
    expect(screen.queryByText('SIP Ladder')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /INVITEsip:1001@a.local→sip:2001@b.local/i }));
    await screen.findByText('SIP Ladder');
    expect(screen.getByText('call-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /BYEsip:1002@a.local→sip:2002@b.local/i }));
    await waitFor(() => expect(screen.getByText('call-2')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /INVITEsip:1000@a.local→sip:2000@b.local/i }));
    expect(screen.getByText('No Call-ID available for this message')).toBeInTheDocument();

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('Panel E: clicking failure row opens ladder with rendered failure highlight', async () => {
    const { container } = render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));

    await waitFor(() => expect(screen.getByText('Recent Call Failures')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Busy Here'));

    await screen.findByText('SIP Ladder');
    await waitFor(() => expect(screen.getByText('fail-call-1')).toBeInTheDocument());

    const errorStrokes = container.querySelectorAll('g[class*="arrowError"]');
    expect(errorStrokes.length).toBeGreaterThan(0);
  });
});
