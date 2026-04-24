import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignsPage } from './CampaignsPage';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listCampaigns: vi.fn(async () => ({
    campaigns: [
      {
        id: 1,
        name: 'April Outreach',
        status: 'running',
        flowId: 3,
        trunkId: 1,
        defaultCountry: 'US',
        flowName: 'main flow',
        trunkName: 'primary',
        scheduledAt: '2026-04-25T09:00:00.000Z',
        maxConcurrent: 3,
        maxRetries: 2,
        retryIntervalMinutes: 30,
        totalContacts: 100,
        dialedCount: 22,
        answeredCount: 14,
        failedCount: 8,
        createdAt: '2026-04-23T09:00:00.000Z',
        updatedAt: '2026-04-23T09:00:00.000Z',
      },
    ],
    total: 1,
  })),
  listFlows: vi.fn(async () => ({ data: [] })),
  listTrunks: vi.fn(async () => ({ data: [] })),
  createCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  deleteCampaign: vi.fn(),
  scheduleCampaign: vi.fn(),
  stopCampaign: vi.fn(),
  uploadCampaignContacts: vi.fn(),
}));

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders campaign list', async () => {
    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('April Outreach')).toBeInTheDocument());
  });

  it('status badge renders class for running status', async () => {
    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    const badge = await screen.findByText('running');
    expect(badge.className).toContain('statusRunning');
  });

  it('progress bar shows for running campaign', async () => {
    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('14/100')).toBeInTheDocument());
  });

  it('new campaign button opens drawer', async () => {
    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /new campaign/i }));
    await waitFor(() => expect(screen.getByText('new campaign')).toBeInTheDocument());
  });

  it('shows empty state', async () => {
    (api.listCampaigns as any).mockResolvedValueOnce({ campaigns: [], total: 0 });

    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('No campaigns yet.')).toBeInTheDocument());
  });

  it('create button visible', async () => {
    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: /new campaign/i })).toBeVisible();
  });
});
