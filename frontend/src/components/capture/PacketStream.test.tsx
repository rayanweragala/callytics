import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SipPacket } from '../../types';
import { PacketStream } from './PacketStream';
import styles from './PacketStream.module.css';

function buildPacket(overrides: Partial<SipPacket> = {}): SipPacket {
  return {
    id: overrides.id ?? 'id-1',
    timestamp: overrides.timestamp ?? '10:00:00.000',
    method: overrides.method ?? 'INVITE',
    from: overrides.from ?? '1001',
    to: overrides.to ?? '1002',
    callId: overrides.callId ?? 'call-id-1',
    direction: overrides.direction ?? 'in',
    statusCode: overrides.statusCode,
    rawJson: overrides.rawJson ?? '{}',
  };
}

describe('PacketStream', () => {
  it('applies method filter using shared dropdown', async () => {
    const packets: SipPacket[] = [
      buildPacket({ id: '1', method: 'INVITE', callId: 'call-invite' }),
      buildPacket({ id: '2', method: 'BYE', timestamp: '10:00:01.000', callId: 'call-bye' }),
    ];

    const onFiltersChange = vi.fn();

    render(
      <PacketStream
        filters={{ method: 'all', callId: '', endpoint: null, from: '', to: '' }}
        onFiltersChange={onFiltersChange}
        onSelectCallId={vi.fn()}
        packets={packets}
        selectedCallId={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'INVITE' }));

    expect(onFiltersChange).toHaveBeenCalledWith({ method: 'INVITE', callId: '', endpoint: null, from: '', to: '' });
  });

  it('calls onSelectCallId when a row is clicked', () => {
    const packet = buildPacket({ callId: 'call-select' });
    const onSelectCallId = vi.fn();

    render(
      <PacketStream
        filters={{ method: 'all', callId: '', endpoint: null, from: '', to: '' }}
        onFiltersChange={vi.fn()}
        onSelectCallId={onSelectCallId}
        packets={[packet]}
        selectedCallId={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /10:00:00\.000 INVITE 1001 1002 call-select/i }));
    expect(onSelectCallId).toHaveBeenCalledWith('call-select');
  });

  it('supports pagination with shared Newer/Older controls', async () => {
    const packets = Array.from({ length: 16 }, (_, index) => buildPacket({
      id: `id-${index + 1}`,
      timestamp: `10:00:${String(index).padStart(2, '0')}.000`,
      callId: `call-${index + 1}`,
    }));

    render(
      <PacketStream
        filters={{ method: 'all', callId: '', endpoint: null, from: '', to: '' }}
        onFiltersChange={vi.fn()}
        onSelectCallId={vi.fn()}
        packets={packets}
        selectedCallId={null}
      />,
    );

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Older/i }));

    await waitFor(() => {
      expect(screen.getByText('2 / 2')).toBeInTheDocument();
    });
  });

  it('applies row colour classes for timestamp, methods, and errors', () => {
    const packets: SipPacket[] = [
      buildPacket({ id: 'invite', method: 'INVITE', callId: 'call-invite' }),
      buildPacket({ id: 'bye', method: 'BYE', timestamp: '10:00:01.000', callId: 'call-bye' }),
      buildPacket({ id: 'error', method: '486', timestamp: '10:00:02.000', callId: 'call-error', statusCode: 486 }),
    ];

    render(
      <PacketStream
        filters={{ method: 'all', callId: '', endpoint: null, from: '', to: '' }}
        onFiltersChange={vi.fn()}
        onSelectCallId={vi.fn()}
        packets={packets}
        selectedCallId={'call-error'}
      />,
    );

    expect(screen.getByText('10:00:00.000')).toHaveClass(styles.timeCell);
    expect(screen.getByText('INVITE')).toHaveClass(styles.methodInvite);
    expect(screen.getByText('BYE')).toHaveClass(styles.methodBye);

    const errorRow = screen.getByRole('button', { name: /10:00:02\.000 486 1001 1002 call-error/i });
    expect(errorRow).toHaveClass(styles.errorRow);
    expect(errorRow).toHaveClass(styles.selectedRow);
  });
});
