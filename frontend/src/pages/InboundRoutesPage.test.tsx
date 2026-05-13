import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { InboundRoutesPage } from './InboundRoutesPage';

import * as api from '../lib/api';
import { renderWithRouter } from '../test/renderWithRouter';

vi.mock('../lib/api', () => ({
  listInboundRoutes: vi.fn(),
  listFlows: vi.fn(),
  createInboundRoute: vi.fn(),
  updateInboundRoute: vi.fn(),
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

    renderWithRouter(<InboundRoutesPage />);

    await waitFor(() => expect(screen.getByText('123456')).toBeInTheDocument());
    
    fireEvent.click(screen.getByRole('button', { name: /add route/i }));
    expect(screen.getByText('new route')).toBeInTheDocument();
  });

  it('shows inline DID conflict on create when backend reports extension collision', async () => {
    (api.listInboundRoutes as any).mockResolvedValue({ data: [], total: 0 });
    (api.listFlows as any).mockResolvedValue(mockFlows);
    (api.createInboundRoute as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          message: 'This number is already in use as an extension. Choose a different DID.',
        },
      },
    });

    renderWithRouter(<InboundRoutesPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: /add route/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add route/i }));
    fireEvent.change(screen.getByLabelText('did'), { target: { value: '2001' } });
    fireEvent.click(screen.getByRole('button', { name: 'flow' }));
    fireEvent.click(screen.getByText('Main Flow'));
    fireEvent.click(screen.getByRole('button', { name: 'save route' }));

    expect(await screen.findByText('This number is already in use as an extension. Choose a different DID.')).toBeInTheDocument();
    expect(screen.queryByText('failed to create route')).not.toBeInTheDocument();
  });
});
