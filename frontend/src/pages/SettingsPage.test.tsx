import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { renderWithRouter } from '../test/renderWithRouter';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

describe('SettingsPage coverage boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSettings).mockResolvedValue({
      default_outbound_trunk_id: null,
      record_outbound_calls: false,
      recording_retention_days: 0,
    });
    vi.mocked(api.updateSettings).mockResolvedValue({
      default_outbound_trunk_id: null,
      record_outbound_calls: false,
      recording_retention_days: 0,
    });
  });

  it('renders retention settings content', async () => {
    renderWithRouter(<SettingsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Recordings' })).toBeInTheDocument();
    expect(screen.getByText('Set to 0 to keep recordings indefinitely.')).toBeInTheDocument();
  });
});
