import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CampaignDetailPage } from './CampaignDetailPage';

vi.mock('../lib/api', () => ({
  getCampaign: vi.fn(async () => ({
    id: 1,
    name: 'April Outreach',
    status: 'scheduled',
    flowId: 3,
    trunkId: 1,
    callerId: null,
    defaultCountry: 'US',
    flowName: 'Main Flow',
    trunkName: 'Primary Trunk',
    trunkCallerId: null,
    scheduledAt: '2026-04-25T09:00:00.000Z',
    maxConcurrent: 3,
    maxRetries: 2,
    retryIntervalMinutes: 30,
    totalContacts: 42,
    dialedCount: 20,
    answeredCount: 12,
    failedCount: 8,
    createdAt: '2026-04-24T00:00:00.000Z',
    updatedAt: '2026-04-24T00:00:00.000Z',
  })),
  listCampaignContacts: vi.fn(async () => ({
    contacts: [],
    total: 0,
  })),
  listCampaignContactAttempts: vi.fn(async () => []),
  getCampaignProgress: vi.fn(async () => ({
    status: 'scheduled',
    totalContacts: 42,
    dialedCount: 20,
    answeredCount: 12,
    failedCount: 8,
    pendingCount: 22,
    activeCallCount: 0,
  })),
  stopCampaign: vi.fn(async () => ({})),
}));

describe('CampaignDetailPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={['/campaigns/1']}>
        <Routes>
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('renders campaign name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'April Outreach' })).toBeInTheDocument());
  });

  it('shows contact count', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('total 42')).toBeInTheDocument());
  });

  it('shows status badge', async () => {
    renderPage();
    await waitFor(() =>
      expect(document.querySelector('[class*="campaignStatusBadge"]')?.textContent?.toLowerCase()).toContain('scheduled'),
    );
  });
});
