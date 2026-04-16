import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DiagnosticsPage } from './DiagnosticsPage';
import { MemoryRouter } from 'react-router-dom';
import { diagnosticsSocket } from '../lib/socket';

vi.mock('../lib/api', () => ({
  listFlows: vi.fn(() => Promise.resolve({ data: [], total: 0 })),
}));

vi.mock('../lib/socket', () => {
  const listeners: Record<string, Function> = {};
  return {
    diagnosticsSocket: {
      on: vi.fn((event, cb) => { listeners[event] = cb; }),
      off: vi.fn(),
      emit: vi.fn((event, data, cb) => {
        if (event === 'get_snapshot' && typeof cb === 'function') {
          cb({
            activeCalls: 5,
            registeredEndpoints: 10,
            flows: 3,
            uptimeSeconds: 3600,
            sipStatuses: [],
            liveExecution: [],
          });
        }
      }),
      _trigger: (event: string, data: any) => {
        if (listeners[event]) listeners[event](data);
      }
    },
  };
});

describe('DiagnosticsPage coverage boost', () => {
  it('renders default stats when no socket snapshot events are emitted', async () => {
    render(
      <MemoryRouter>
        <DiagnosticsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('00:00:00')).toBeInTheDocument());
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3);
  });
});
