import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { InboundRoutesPage } from './InboundRoutesPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listInboundRoutes: vi.fn(),
  listFlows: vi.fn(),
  createInboundRoute: vi.fn(),
  deleteInboundRoute: vi.fn(),
}));

describe('InboundRoutesPage coverage boost', () => {
  const mockRoutes = {
    data: [
      { id: 1, did: '123456', label: 'Main', flowId: 1, flowName: 'Main Flow', createdAt: new Date().toISOString() },
    ],
    total: 1,
  };

  const mockFlows = {
    data: [{ id: 1, name: 'Main Flow' }],
    total: 1,
  };

  it('renders routes and opens create form', async () => {
    (api.listInboundRoutes as any).mockResolvedValue(mockRoutes);
    (api.listFlows as any).mockResolvedValue(mockFlows);

    render(
      <MemoryRouter>
        <InboundRoutesPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
    
    fireEvent.click(screen.getByRole('button', { name: /add route/i }));
    expect(screen.getByText('new route')).toBeInTheDocument();
  });
});
