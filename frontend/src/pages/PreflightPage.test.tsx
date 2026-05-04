import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PreflightPage } from './PreflightPage';
import * as api from '../lib/api';
import styles from './PreflightPage.module.css';

vi.mock('../lib/api', () => ({
  getPreflightHistory: vi.fn(),
  runPreflightChecks: vi.fn(),
}));

const passRun = {
  id: 1,
  ranAt: '2026-04-23T10:00:00.000Z',
  summary: 'pass',
  checks: [
    {
      id: 'asterisk_ari',
      label: 'Asterisk ARI reachable',
      status: 'pass',
      message: 'Asterisk 20.1.0 is running',
      detail: '',
    },
  ],
};

const warnRun = {
  id: 2,
  ranAt: '2026-04-23T10:01:00.000Z',
  summary: 'warn',
  checks: [
    {
      id: 'sip_alg',
      label: 'SIP ALG (router setting)',
      status: 'warn',
      message: 'warn message',
      detail: 'warn detail',
    },
  ],
};

const failRun = {
  id: 3,
  ranAt: '2026-04-23T10:02:00.000Z',
  summary: 'fail',
  checks: [
    {
      id: 'asterisk_ari',
      label: 'Asterisk ARI reachable',
      status: 'fail',
      message: 'Asterisk ARI is not reachable. Asterisk may not have started.',
      detail: 'HTTP 500',
    },
  ],
};

function pagedHistory(runs: typeof passRun[] | typeof warnRun[] | typeof failRun[] | Array<typeof passRun | typeof warnRun | typeof failRun>) {
  return {
    data: runs,
    total: runs.length,
    page: 1,
    limit: 10,
    totalPages: 1,
  };
}

describe('PreflightPage', () => {
  beforeEach(() => {
    (api.getPreflightHistory as any).mockResolvedValue(pagedHistory([]));
    (api.runPreflightChecks as any).mockResolvedValue(passRun);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with empty history', async () => {
    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'preflight wizard' })).toBeInTheDocument();
    });
    expect(screen.getByText("No runs recorded yet. Click 'run checks' to start.")).toBeInTheDocument();
  });

  it('run checks button triggers POST /preflight/run', async () => {
    (api.getPreflightHistory as any).mockResolvedValueOnce(pagedHistory([])).mockResolvedValueOnce(pagedHistory([passRun]));

    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'run checks' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'run checks' }));

    await waitFor(() => {
      expect(api.runPreflightChecks).toHaveBeenCalledTimes(1);
    });
  });

  it('summary banner renders with warn class when summary is warn', async () => {
    (api.getPreflightHistory as any).mockResolvedValue(pagedHistory([warnRun]));

    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    const banner = await screen.findByText('Some warnings detected. Review the items below.');
    expect(banner).toHaveClass(styles.summaryBanner);
    expect(banner).toHaveClass(styles.summaryWarn);
  });

  it('summary banner renders with fail class when summary is fail', async () => {
    (api.getPreflightHistory as any).mockResolvedValue(pagedHistory([failRun]));

    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    const banner = await screen.findByText('One or more checks failed. Review the issues below.');
    expect(banner).toHaveClass(styles.summaryBanner);
    expect(banner).toHaveClass(styles.summaryFail);
  });

  it('auto-refresh countdown text is visible when summary is warn', async () => {
    (api.getPreflightHistory as any).mockResolvedValue(pagedHistory([warnRun]));

    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Re-checking in 30s/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'stop auto-refresh' })).toBeInTheDocument();
  });

  it('history table renders correct number of rows from mock history response', async () => {
    (api.getPreflightHistory as any).mockResolvedValue(pagedHistory([passRun, warnRun, failRun]));

    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Run history')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: 'view' })).toHaveLength(3);
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('clicking view on a history row toggles the expanded check detail section', async () => {
    const historyOnlyWarnRun = {
      ...warnRun,
      id: 4,
      checks: [
        {
          ...warnRun.checks[0],
          detail: 'history row warn detail',
        },
      ],
    };

    (api.getPreflightHistory as any).mockResolvedValue(pagedHistory([passRun, historyOnlyWarnRun]));

    render(
      <MemoryRouter>
        <PreflightPage />
      </MemoryRouter>,
    );

    const viewButtons = await screen.findAllByRole('button', { name: 'view' });
    expect(screen.queryByText('history row warn detail')).not.toBeInTheDocument();

    fireEvent.click(viewButtons[1]);
    expect(await screen.findByText('history row warn detail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'hide' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'hide' }));
    await waitFor(() => {
      expect(screen.queryByText('history row warn detail')).not.toBeInTheDocument();
    });
  });
});
