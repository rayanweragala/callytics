import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDiagnosticsSipMessages } from '../../lib/api';
import { SipTrafficInspector } from './SipTrafficInspector';

vi.mock('../../lib/api', () => ({
  getDiagnosticsSipMessages: vi.fn(),
}));

describe('SipTrafficInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDiagnosticsSipMessages).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 5,
    });
  });

  it('renders rows, toggles pause, and filters traffic', async () => {
    const onClear = vi.fn();
    const inviteTimestamp = new Date().toISOString();
    const byeTimestamp = new Date(Date.now() + 1000).toISOString();

    vi.mocked(getDiagnosticsSipMessages).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          callId: 'call-a',
          timestamp: inviteTimestamp,
          method: 'INVITE',
          fromUri: '1001',
          toUri: 'trunk',
          direction: 'outbound',
          responseCode: null,
          rawMessage: 'INVITE sip:trunk SIP/2.0',
          createdAt: null,
        },
        {
          id: 2,
          callId: 'call-b',
          timestamp: byeTimestamp,
          method: 'BYE',
          fromUri: 'trunk',
          toUri: '1001',
          direction: 'inbound',
          responseCode: null,
          rawMessage: 'BYE sip:1001 SIP/2.0',
          createdAt: null,
        },
      ],
      total: 2,
      page: 1,
      limit: 5,
    });

    render(<SipTrafficInspector items={[]} onClear={onClear} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /INVITE.*1001.*trunk/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('method filter'), { target: { value: 'BYE' } });
    expect(screen.getByRole('button', { name: /BYE.*trunk.*1001/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /INVITE.*1001.*trunk/i })).not.toBeInTheDocument();
  });

  it('formats row timestamp as HH:MM:SS.mmm', async () => {
    vi.mocked(getDiagnosticsSipMessages).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          callId: 'call-c',
          timestamp: '2026-04-17T10:11:12.345Z',
          method: 'INVITE',
          fromUri: '1001',
          toUri: 'trunk',
          direction: 'outbound',
          responseCode: null,
          rawMessage: 'INVITE sip:trunk SIP/2.0',
          createdAt: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
    });

    render(<SipTrafficInspector items={[]} onClear={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/\d{2}:\d{2}:\d{2}\.\d{3}/)).toBeInTheDocument();
    });
  });

  it('renders empty state when no items provided', async () => {
    render(<SipTrafficInspector items={[]} onClear={() => {}} />);

    await waitFor(() => {
      expect(getDiagnosticsSipMessages).toHaveBeenCalledWith(1, 5);
    });
    expect(screen.getByText('SIP Traffic Inspector')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /↑|↓/ })).toHaveLength(0);
  });

  it('calls onRowClick with the row call id', async () => {
    const onRowClick = vi.fn();

    vi.mocked(getDiagnosticsSipMessages).mockResolvedValueOnce({
      data: [
        {
          id: 1,
          callId: 'call-row-1',
          timestamp: new Date().toISOString(),
          method: 'INVITE',
          fromUri: '1001',
          toUri: 'trunk',
          direction: 'outbound',
          responseCode: null,
          rawMessage: 'INVITE sip:trunk SIP/2.0',
          createdAt: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 5,
    });

    render(<SipTrafficInspector items={[]} onClear={() => {}} onRowClick={onRowClick} />);

    const rowButton = await screen.findByRole('button', { name: /INVITE.*1001.*trunk/i });
    fireEvent.click(rowButton);
    expect(onRowClick).toHaveBeenCalledWith('call-row-1');
  });
});
