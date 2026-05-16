import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Softphone } from './Softphone';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getHostConfig: vi.fn(),
  listOperators: vi.fn(),
}));

describe('Softphone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getHostConfig).mockResolvedValue({
      hostIp: '127.0.0.1',
      sipPort: 5060,
    });
    vi.mocked(api.listOperators).mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Alice',
          status: 'offline',
          extension: {
            id: 10,
            username: '2001',
            password: 'secret',
            displayName: 'Alice',
            transportType: 'webrtc',
            vpnOnly: false,
            createdAt: new Date().toISOString(),
          },
          contactNumber: undefined,
          hasPIN: false,
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      limit: 200,
      totalPages: 1,
    });
  });

  it('renders in collapsed state by default', async () => {
    render(<Softphone />);

    expect(
      screen.getByRole('button', { name: /open softphone/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/softphone panel/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(api.listOperators).toHaveBeenCalledWith(1, 200);
    });
  });

  it('toggles the expanded panel when the bubble is clicked', async () => {
    render(<Softphone />);

    fireEvent.click(screen.getByRole('button', { name: /open softphone/i }));

    expect(await screen.findByLabelText(/softphone panel/i)).toBeInTheDocument();
    expect(screen.getByText(/operator extension/i)).toBeInTheDocument();
  });

  it('shows unregistered status when no user agent is connected', async () => {
    render(<Softphone />);

    fireEvent.click(screen.getByRole('button', { name: /open softphone/i }));

    await waitFor(() => {
      expect(screen.getByText('Unregistered')).toBeInTheDocument();
    });
  });
});
