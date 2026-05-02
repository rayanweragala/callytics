import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TrunksPage } from './TrunksPage';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  listTrunks: vi.fn(),
  listAllAudio: vi.fn(),
  createTrunk: vi.fn(),
  updateTrunk: vi.fn(),
  deleteTrunk: vi.fn(),
  testTrunk: vi.fn(),
  testTrunkOutbound: vi.fn(),
  testTrunkInbound: vi.fn(),
  getTrunkTestStatus: vi.fn(),
}));

describe('TrunksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listTrunks as any).mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Main Trunk',
          providerPreset: 'generic',
          host: 'sip.provider.com',
          port: 5060,
          username: null,
          password: null,
          fromDomain: null,
          fromUser: null,
          dialFormat: '{number}',
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });
    (api.getSettings as any).mockResolvedValue({
      data: {
        default_outbound_trunk_id: null,
        record_outbound_calls: false,
      },
    });
    (api.updateSettings as any).mockResolvedValue({
      data: {
        default_outbound_trunk_id: 1,
        record_outbound_calls: false,
      },
    });
    (api.listAllAudio as any).mockResolvedValue({ data: [] });
    (api.testTrunk as any).mockResolvedValue({
      status: 'reachable',
      message: 'Reachable - 20ms',
      rtt_ms: 20,
    });
  });

  it('shows action row buttons: edit, delete, and overflow menu', async () => {
    render(
      <MemoryRouter>
        <TrunksPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Main Trunk')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '···' })).toBeInTheDocument();
  });

  it('opens overflow and triggers quick test action', async () => {
    render(
      <MemoryRouter>
        <TrunksPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Main Trunk')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '···' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick Test' }));

    await waitFor(() => {
      expect(api.testTrunk).toHaveBeenCalledWith(1);
    });
  });

  it('shows the direct outbound settings note when no default trunk is selected', async () => {
    render(
      <MemoryRouter>
        <TrunksPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Direct outbound dial is disabled. Select a default trunk to enable it.')).toBeInTheDocument());
    expect(screen.getByText('default outbound trunk')).toBeInTheDocument();
    expect(screen.getByText('Record outbound calls')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Record outbound calls' })).toBeInTheDocument();
  });
});
