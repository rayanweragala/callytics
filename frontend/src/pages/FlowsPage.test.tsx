import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FlowsPage } from './FlowsPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listFlows: vi.fn(),
  createFlow: vi.fn(),
  deleteFlow: vi.fn(),
}));

describe('FlowsPage coverage boost', () => {
  const mockFlows = {
    data: [
      { id: 1, name: 'Main Flow', description: 'Main IVR', createdAt: new Date().toISOString() },
    ],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  };

  it('renders flows and shows the create button', async () => {
    (api.listFlows as any).mockResolvedValue(mockFlows);

    render(
      <MemoryRouter>
        <FlowsPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Main Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new flow/i }));
    expect(screen.getByRole('button', { name: /new flow/i })).toBeInTheDocument();
  });
});
