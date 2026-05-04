import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { QualityDrawer } from './QualityDrawer';

const navigateSpy = vi.fn();
const getCallQualityMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getCallQuality: (...args: any[]) => getCallQualityMock(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

describe('QualityDrawer', () => {
  it('shows no-data message when quality is unavailable', async () => {
    getCallQualityMock.mockResolvedValueOnce(null);

    render(
      <MemoryRouter>
        <QualityDrawer callId="call-1" onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('No quality data available for this call.')).toBeInTheDocument();
    });
  });

  it('renders quality data and navigates to capture', async () => {
    const onClose = vi.fn();
    getCallQualityMock.mockResolvedValueOnce({
      callId: 'call-2',
      mos: 3.91,
      jitter: 80,
      packetLoss: 2,
      rtt: 130,
      grade: 'fair',
      recordedAt: '2026-04-22T19:00:00.000Z',
    });

    render(
      <MemoryRouter>
        <QualityDrawer callId="call-2" onClose={onClose} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('3.91')).toBeInTheDocument();
      expect(screen.getByText('High jitter caused audio instability.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'View in Capture' }));

    expect(onClose).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith('/capture?callId=call-2');
  });
});
