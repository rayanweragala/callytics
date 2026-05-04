import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsPage } from './DiagnosticsPage';

vi.mock('../lib/api', () => ({
  getDiagnosticsHealth: vi.fn(async () => ({
    ari: { connected: true, latencyMs: 8 },
    ami: { connected: true },
    asterisk: { version: '20.0.0', uptimeSeconds: 3600 },
    activeChannels: 3,
    postgres: { reachable: true },
    redis: { reachable: true },
    checkedAt: new Date().toISOString(),
    items: [
      { label: 'ARI', state: 'healthy', detail: '8 ms' },
      { label: 'AMI', state: 'healthy', detail: 'Connected' },
    ],
  })),
  getDiagnosticsRegistrations: vi.fn(async () => ({
    extensions: [{ extension: '1001', displayName: 'Alice', status: 'registered', registeredIp: '127.0.0.1', lastSeen: new Date().toISOString(), expiresIn: 600 }],
    trunks: [{ trunkName: 'Main trunk', host: 'sip.example.com', status: 'registered', lastRegistration: new Date().toISOString(), expiresIn: 600 }],
  })),
  listTrunks: vi.fn(async () => ({
    data: [{ id: 1, name: 'Main trunk', providerPreset: 'generic', host: 'sip.example.com', port: 5060, protocol: 'udp', username: null, password: null, fromDomain: null, fromUser: null, dialFormat: '{number}', enabled: true, createdAt: new Date().toISOString() }],
    total: 1,
  })),
  getDiagnosticsFailures: vi.fn(async () => ({
    data: [{ id: 1, callId: 'call-1', time: new Date().toISOString(), callerId: '1001', flowName: 'Main', failedNodeType: 'transfer', errorMessage: 'Busy', durationSeconds: 4 }],
    total: 1,
  })),
  testDiagnosticsTrunk: vi.fn(),
  testAllDiagnosticsTrunks: vi.fn(),
}));

vi.mock('../lib/socket', () => ({
  diagnosticsSocket: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('DiagnosticsPage', () => {
  it('renders diagnostics panels without crashing', async () => {
    render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>,
    );

    // Default tab is Network
    await waitFor(() => expect(screen.getByText('System Health')).toBeInTheDocument());

    // Trunks tab
    fireEvent.click(screen.getByRole('button', { name: 'Trunks' }));
    await waitFor(() => expect(screen.getByText('Trunk Health')).toBeInTheDocument());

    // Traffic tab
    fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));
    await waitFor(() => expect(screen.getByText('SIP Traffic Inspector')).toBeInTheDocument());
    expect(screen.getByText('Recent Call Failures')).toBeInTheDocument();
  });
});
