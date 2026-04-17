import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CallLogsPage } from './CallLogsPage';

vi.mock('../lib/socket', () => ({
  diagnosticsSocket: {
    connected: false,
    emit: vi.fn((eventName, _payload, callback) => {
      if (typeof callback !== 'function') {
        return;
      }

      if (eventName === 'diagnostics:live-execution:list') {
        callback({ data: [], total: 0 });
        return;
      }

      if (eventName === 'diagnostics:sip-status:list') {
        callback({ data: [], total: 0 });
      }
    }),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('CallLogsPage', () => {
  it('renders without crashing', async () => {
    render(
      <MemoryRouter>
        <CallLogsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Call Logs' })).toBeInTheDocument());
  });
});
