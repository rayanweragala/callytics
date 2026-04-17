import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SipTrafficInspector } from './SipTrafficInspector';

describe('SipTrafficInspector', () => {
  it('renders rows, toggles pause, and filters traffic', () => {
    const onClear = vi.fn();
    const inviteTimestamp = new Date().toISOString();
    const byeTimestamp = new Date(Date.now() + 1000).toISOString();

    render(
      <SipTrafficInspector
        items={[
          {
            timestamp: inviteTimestamp,
            method: 'INVITE',
            from: '1001',
            to: 'trunk',
            direction: 'outbound',
            responseCode: null,
            rawMessage: 'INVITE sip:trunk SIP/2.0',
          },
          {
            timestamp: byeTimestamp,
            method: 'BYE',
            from: 'trunk',
            to: '1001',
            direction: 'inbound',
            responseCode: null,
            rawMessage: 'BYE sip:1001 SIP/2.0',
          },
        ]}
        onClear={onClear}
      />,
    );

    expect(screen.getByRole('button', { name: /INVITE1001→trunk/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('method filter'), { target: { value: 'BYE' } });
    expect(screen.getByRole('button', { name: /BYEtrunk→1001/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /INVITE1001→trunk/i })).not.toBeInTheDocument();
  });

  it('formats row timestamp as HH:MM:SS.mmm', () => {
    render(
      <SipTrafficInspector
        items={[
          {
            timestamp: '2026-04-17T10:11:12.345Z',
            method: 'INVITE',
            from: '1001',
            to: 'trunk',
            direction: 'outbound',
            responseCode: null,
            rawMessage: 'INVITE sip:trunk SIP/2.0',
          },
        ]}
        onClear={() => {}}
      />,
    );

    expect(screen.getByText(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/)).toBeInTheDocument();
  });

  it('renders empty state when no items provided', () => {
    render(<SipTrafficInspector items={[]} onClear={() => {}} />);

    expect(screen.getByText('SIP Traffic Inspector')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /↑|↓/ })).toHaveLength(0);
  });
});
