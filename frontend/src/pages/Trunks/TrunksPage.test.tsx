import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TrunksPage } from './TrunksPage';
import { MemoryRouter } from 'react-router-dom';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  listTrunks: vi.fn(),
  createTrunk: vi.fn(),
  deleteTrunk: vi.fn(),
  testTrunk: vi.fn(),
}));

describe('TrunksPage coverage boost', () => {
  const mockTrunks = {
    data: [
      { id: 1, name: 'Main Trunk', host: 'sip.provider.com', enabled: true, createdAt: new Date().toISOString() },
    ],
    total: 1,
  };

  it('renders trunks and opens create form', async () => {
    (api.listTrunks as any).mockResolvedValue(mockTrunks);

    render(
      <MemoryRouter>
        <TrunksPage />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Main Trunk')).toBeInTheDocument());
    
    fireEvent.click(screen.getByText(/\+ add trunk/i));
    expect(screen.getByText('new trunk')).toBeInTheDocument();
  });
});
