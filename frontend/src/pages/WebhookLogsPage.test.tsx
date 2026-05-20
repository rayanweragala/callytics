import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookLogsPage } from './WebhookLogsPage';
import { renderWithRouter } from '../test/renderWithRouter';
import type { WebhookDeliveryItem } from '../types';

const { listWebhookDeliveries } = vi.hoisted(() => ({
  listWebhookDeliveries: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  listWebhookDeliveries,
}));

const deliveries: WebhookDeliveryItem[] = [
  {
    id: 'attempt-1',
    flowId: 12,
    nodeId: 'node-success',
    callId: 'call-1',
    url: 'https://example.com/hook/primary',
    attemptNumber: 1,
    httpStatus: 500,
    responseBody: null,
    success: false,
    errorMessage: 'timeout',
    createdAt: '2026-05-17T10:00:00.000Z',
  },
  {
    id: 'attempt-2',
    flowId: 12,
    nodeId: 'node-success',
    callId: 'call-1',
    url: 'https://example.com/hook/primary',
    attemptNumber: 2,
    httpStatus: 200,
    responseBody: 'ok',
    success: true,
    errorMessage: null,
    createdAt: '2026-05-17T10:00:03.000Z',
  },
  {
    id: 'attempt-3',
    flowId: 18,
    nodeId: 'node-failed',
    callId: 'call-2',
    url: 'https://example.com/hook/failure',
    attemptNumber: 1,
    httpStatus: 500,
    responseBody: null,
    success: false,
    errorMessage: 'upstream 500',
    createdAt: '2026-05-17T11:00:00.000Z',
  },
  {
    id: 'attempt-4',
    flowId: 18,
    nodeId: 'node-failed',
    callId: 'call-2',
    url: 'https://example.com/hook/failure',
    attemptNumber: 2,
    httpStatus: 500,
    responseBody: null,
    success: false,
    errorMessage: 'still failing',
    createdAt: '2026-05-17T11:00:04.000Z',
  },
  {
    id: 'attempt-5',
    flowId: 18,
    nodeId: 'node-failed',
    callId: 'call-2',
    url: 'https://example.com/hook/failure',
    attemptNumber: 3,
    httpStatus: 504,
    responseBody: null,
    success: false,
    errorMessage: 'gateway timeout',
    createdAt: '2026-05-17T11:00:09.000Z',
  },
];

describe('WebhookLogsPage', () => {
  beforeEach(() => {
    listWebhookDeliveries.mockResolvedValue({ data: deliveries, total: deliveries.length, page: 1, limit: 20 });
  });

  it('renders grouped rows, expands attempts, and filters by grouped result', async () => {
    renderWithRouter(<WebhookLogsPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Webhook Logs' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Success' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('gateway timeout')).toBeInTheDocument();
    expect(screen.getByText('node-success')).toBeInTheDocument();
    expect(screen.getByText('node-failed')).toBeInTheDocument();

    const groupedRows = screen.getAllByRole('row').filter((row) => row.textContent?.includes('node-'));
    expect(groupedRows).toHaveLength(2);

    fireEvent.click(screen.getByText('node-success').closest('tr') as HTMLTableRowElement);

    expect(await screen.findByText('delivery attempts')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));

    await waitFor(() => expect(screen.queryByText('node-success')).not.toBeInTheDocument());
    expect(screen.getByText('node-failed')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('gateway timeout')).toBeInTheDocument();
  });

  it('loads raw delivery rows without applying server-side success filtering', async () => {
    renderWithRouter(<WebhookLogsPage />);

    await waitFor(() => expect(listWebhookDeliveries).toHaveBeenCalledWith({}));
  });
});
