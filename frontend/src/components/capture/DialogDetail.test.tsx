import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SipPacket } from '../../types';
import { DialogDetail } from './DialogDetail';
import styles from './DialogDetail.module.css';

vi.mock('../diagnostics/SipLadderPanel', () => ({
  SipLadderPanel: ({ callId }: { callId: string }) => <div>SIP Ladder {callId}</div>,
}));

function packet(overrides: Partial<SipPacket>): SipPacket {
  return {
    id: overrides.id ?? '1',
    timestamp: overrides.timestamp ?? '10:00:00.000',
    method: overrides.method ?? 'INVITE',
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    callId: overrides.callId ?? 'call-1',
    direction: overrides.direction ?? 'in',
    statusCode: overrides.statusCode,
    rawJson: overrides.rawJson ?? '{}',
  };
}

describe('DialogDetail', () => {
  it('renders empty state when no callId is selected', () => {
    render(<DialogDetail selectedCallId={null} selectedDialogPackets={[]} />);
    expect(screen.getByText('Select a packet to inspect')).toBeInTheDocument();
  });

  it('renders green verdict for completed call sequence', () => {
    render(
      <DialogDetail
        selectedCallId="call-1"
        selectedDialogPackets={[
          packet({ id: '1', method: 'INVITE' }),
          packet({ id: '2', method: '200', statusCode: 200 }),
          packet({ id: '3', method: 'BYE' }),
        ]}
      />,
    );

    expect(screen.getByText('Call completed normally')).toBeInTheDocument();
    expect(screen.getByText('Call completed normally').closest(`.${styles.verdictBanner}`)).toHaveClass(styles.verdictGreen);
  });

  it('renders amber verdict for busy response', () => {
    render(
      <DialogDetail
        selectedCallId="call-2"
        selectedDialogPackets={[
          packet({ id: '1', method: 'INVITE', callId: 'call-2' }),
          packet({ id: '2', method: '486', statusCode: 486, callId: 'call-2' }),
        ]}
      />,
    );

    expect(screen.getByText('Called party was busy')).toBeInTheDocument();
    expect(screen.getByText('Called party was busy').closest(`.${styles.verdictBanner}`)).toHaveClass(styles.verdictAmber);
  });

  it('renders red verdict for timeout response', () => {
    render(
      <DialogDetail
        selectedCallId="call-3"
        selectedDialogPackets={[
          packet({ id: '1', method: 'INVITE', callId: 'call-3' }),
          packet({ id: '2', method: '408', statusCode: 408, callId: 'call-3' }),
        ]}
      />,
    );

    expect(screen.getByText('Request timeout — trunk may be unreachable')).toBeInTheDocument();
    expect(screen.getByText('Request timeout — trunk may be unreachable').closest(`.${styles.verdictBanner}`)).toHaveClass(styles.verdictRed);
  });
});
