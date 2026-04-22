import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapturePage } from './CapturePage';

const apiMocks = vi.hoisted(() => ({
  exportCaptureBulk: vi.fn(),
  exportCaptureDialog: vi.fn(),
  getDiagnosticsSipMessagesByCallId: vi.fn(async () => []),
}));

vi.mock('../lib/api', () => ({
  exportCaptureBulk: apiMocks.exportCaptureBulk,
  exportCaptureDialog: apiMocks.exportCaptureDialog,
  getDiagnosticsSipMessagesByCallId: apiMocks.getDiagnosticsSipMessagesByCallId,
}));

const socketMocks = vi.hoisted(() => {
  const handlers: Record<string, ((payload: any) => void) | undefined> = {};
  return {
    handlers,
    diagnosticsSocket: {
      connected: true,
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (payload: any) => void) => { handlers[event] = handler; }),
      off: vi.fn((event: string) => { delete handlers[event]; }),
    },
  };
});

vi.mock('../lib/socket', () => ({ diagnosticsSocket: socketMocks.diagnosticsSocket }));

describe('CapturePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(socketMocks.handlers).forEach((key) => delete socketMocks.handlers[key]);
    apiMocks.exportCaptureBulk.mockResolvedValue(new Blob(['bulk']));
    apiMocks.exportCaptureDialog.mockResolvedValue(new Blob(['dialog']));
  });

  it('renders empty state before packet selection', () => {
    render(
      <MemoryRouter>
        <CapturePage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Select a packet to inspect')).toBeInTheDocument();
    expect(socketMocks.diagnosticsSocket.emit).toHaveBeenCalledWith('capture:subscribe');
  });

  it('renders live packet row and verdict after selecting a packet', async () => {
    render(
      <MemoryRouter>
        <CapturePage />
      </MemoryRouter>,
    );

    socketMocks.handlers['sip:packet']?.({
      id: '1-0',
      timestamp: '10:00:00.000',
      method: 'INVITE',
      from: 'a',
      to: 'b',
      callId: 'call-1',
      direction: 'in',
      rawJson: '{}',
    });
    socketMocks.handlers['sip:packet']?.({
      id: '2-0',
      timestamp: '10:00:01.000',
      method: '200',
      from: 'a',
      to: 'b',
      callId: 'call-1',
      direction: 'in',
      rawJson: '{}',
    });

    const row = await screen.findByRole('button', { name: /10:00:01.000/i });
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText(/no BYE/i)).toBeInTheDocument();
    });
  });

  it('filters packets by method', async () => {
    render(
      <MemoryRouter>
        <CapturePage />
      </MemoryRouter>,
    );

    socketMocks.handlers['sip:packet']?.({ id: '1-0', timestamp: '10:00:00.000', method: 'INVITE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{}' });
    socketMocks.handlers['sip:packet']?.({ id: '2-0', timestamp: '10:00:01.000', method: 'BYE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{}' });

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'INVITE' }));

    await waitFor(() => {
      const inviteRows = screen.getAllByRole('button', { name: /10:00:00\.000.*INVITE/i });
      const byeRow = screen.queryByRole('button', { name: /10:00:01\.000.*BYE/i });
      expect(inviteRows.length).toBeGreaterThan(0);
      expect(byeRow).toBeNull();
    });
  });

  it('supports raw json toggle in headers accordion', async () => {
    render(
      <MemoryRouter>
        <CapturePage />
      </MemoryRouter>,
    );

    socketMocks.handlers['sip:packet']?.({ id: '1-0', timestamp: '10:00:00.000', method: 'INVITE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{"layers":{"sip.Call-ID":["call-1"]}}' });

    fireEvent.click(await screen.findByRole('button', { name: /10:00:00.000/i }));
    fireEvent.click(await screen.findByText(/INVITE · 10:00:00.000/i));
    fireEvent.click(await screen.findByRole('button', { name: '[raw]' }));

    const headerMatches = await screen.findAllByText(/sip\.Call-ID/i);
    expect(headerMatches.length).toBeGreaterThan(0);
  });

  it('calls bulk and dialog export endpoints from page actions', async () => {
    render(
      <MemoryRouter>
        <CapturePage />
      </MemoryRouter>,
    );

    socketMocks.handlers['sip:packet']?.({ id: '1-0', timestamp: '10:00:00.000', method: 'INVITE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{}' });
    fireEvent.click(await screen.findByRole('button', { name: /10:00:00.000/i }));

    fireEvent.click(screen.getByRole('button', { name: /Export \.pcap/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Export this dialog \.pcap/i }));

    await waitFor(() => {
      expect(apiMocks.exportCaptureBulk).toHaveBeenCalled();
      expect(apiMocks.exportCaptureDialog).toHaveBeenCalledWith('call-1');
    });
  });
});
