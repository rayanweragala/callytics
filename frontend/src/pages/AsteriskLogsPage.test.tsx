import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsteriskLogsPage } from './AsteriskLogsPage';
import * as api from '../lib/api';

vi.mock('../lib/api', () => ({
  listAsteriskLogs: vi.fn(),
}));

describe('AsteriskLogsPage', () => {
  beforeEach(() => {
    (api.listAsteriskLogs as any).mockResolvedValue({
      entries: [],
      total: 0,
      fileExists: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('renders without crashing with empty entries', async () => {
    render(
      <MemoryRouter>
        <AsteriskLogsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Asterisk Logs' })).toBeInTheDocument());
    expect(screen.getByText('No log entries match the current filter.')).toBeInTheDocument();
  });

  it('filters by Error level and calls API with level=error', async () => {
    render(
      <MemoryRouter>
        <AsteriskLogsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.listAsteriskLogs).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Error' }));

    await waitFor(() => {
      expect(api.listAsteriskLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        level: 'error',
        search: '',
        hideNoise: true,
        limit: 25,
        offset: 0,
      }));
    });
  });

  it('triggers debounced fetch with search parameter', async () => {
    render(
      <MemoryRouter>
        <AsteriskLogsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.listAsteriskLogs).toHaveBeenCalled());
    (api.listAsteriskLogs as any).mockClear();
    vi.useFakeTimers();

    fireEvent.change(screen.getByPlaceholderText(/Search logs/i), {
      target: { value: '  timeout  ' },
    });

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(api.listAsteriskLogs).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(api.listAsteriskLogs).toHaveBeenCalledWith(expect.objectContaining({
      level: 'all',
      search: 'timeout',
      hideNoise: true,
      limit: 25,
      offset: 0,
    }));
  });

  it('shows call drill-down banner from query params and clears it', async () => {
    render(
      <MemoryRouter initialEntries={['/logs?uniqueid=call-123&from=2026-04-24T10%3A00%3A00.000Z&to=2026-04-24T10%3A00%3A30.000Z']}>
        <AsteriskLogsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(api.listAsteriskLogs).toHaveBeenCalled());
    expect(screen.getByText('Showing logs for call call-123')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

    await waitFor(() => {
      expect(api.listAsteriskLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        uniqueid: undefined,
        from: undefined,
        to: undefined,
      }));
    });
  });
});
