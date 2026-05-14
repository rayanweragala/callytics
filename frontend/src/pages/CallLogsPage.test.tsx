import { render, screen, waitFor } from '@testing-library/react';

import { describe, expect, it, vi } from 'vitest';
import { CallLogsPage } from './CallLogsPage';
import { renderWithRouter } from '../test/renderWithRouter';

vi.mock('../lib/api', () => ({
  getDiagnosticsHealth: vi.fn(async () => ({
    asterisk: { uptimeSeconds: 1200 },
    activeChannels: 0,
  })),
  getDiagnosticsRegistrations: vi.fn(async () => ({ data: [] })),
  listFlows: vi.fn(async () => ({ total: 0 })),
  listCallLogs: vi.fn(async () => ({ data: [], total: 0, page: 1, limit: 25, totalPages: 1 })),
  getCallQuality: vi.fn(async () => null),
  getCallTrace: vi.fn(async () => ({ callUuid: 'x', callerNumber: null, startTime: null, nodes: [] })),
}));

vi.mock('../lib/socket', () => ({
  diagnosticsSocket: {
    connected: false,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('CallLogsPage', () => {
  it('renders the page heading and table shell', async () => {
    renderWithRouter(<CallLogsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Call Logs' })).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Search caller number')).toBeInTheDocument();
  });
});
