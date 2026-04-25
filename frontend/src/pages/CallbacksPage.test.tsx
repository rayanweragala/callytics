import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import { CallbacksPage } from './CallbacksPage';

vi.mock('../lib/api', () => ({
  listCallbacks: vi.fn(),
  executeCallback: vi.fn(),
  cancelCallback: vi.fn(),
}));

describe('CallbacksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listCallbacks as any).mockResolvedValue({
      data: [
        {
          id: 1,
          flowId: null,
          trunkId: null,
          customerNumber: '+94770000001',
          operatorId: 3,
          operatorName: 'Alice',
          status: 'pending',
          failReason: null,
          callLogId: null,
          createdAt: '2026-04-25T00:00:00.000Z',
          executedAt: null,
          completedAt: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    (api.executeCallback as any).mockResolvedValue({ success: true });
    (api.cancelCallback as any).mockResolvedValue({ success: true });
  });

  it('renders callback row and pending action buttons', async () => {
    render(
      <MemoryRouter>
        <CallbacksPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('+94770000001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Call Now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('triggers execute endpoint', async () => {
    render(
      <MemoryRouter>
        <CallbacksPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Call Now' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Call Now' }));

    await waitFor(() => {
      expect(api.executeCallback).toHaveBeenCalledWith(1);
    });
  });

  it('shows inline cancel confirm and confirms cancel', async () => {
    render(
      <MemoryRouter>
        <CallbacksPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByText('Cancel callback?')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(api.cancelCallback).toHaveBeenCalledWith(1);
    });
  });
});
