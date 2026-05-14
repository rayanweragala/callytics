import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SipPacket } from '../types';
import { CapturePage } from './CapturePage';
import { renderWithRouter } from '../test/renderWithRouter';

const apiMocks = vi.hoisted(() => ({
  exportCaptureBulk: vi.fn(),
  exportCaptureDialog: vi.fn(),
  getCapturePackets: vi.fn<(callId: string) => Promise<SipPacket[]>>(async () => []),
  getDiagnosticsSipMessagesByCallId: vi.fn<(callId: string) => Promise<unknown[]>>(async () => []),
}));

vi.mock('../lib/api', () => ({
  exportCaptureBulk: apiMocks.exportCaptureBulk,
  exportCaptureDialog: apiMocks.exportCaptureDialog,
  getCapturePackets: apiMocks.getCapturePackets,
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
    apiMocks.getCapturePackets.mockResolvedValue([]);
  });

  it('renders empty state before packet selection', () => {
    renderWithRouter(<CapturePage />);

    expect(screen.getByText('Select a packet to inspect')).toBeInTheDocument();
    expect(socketMocks.diagnosticsSocket.emit).toHaveBeenCalledWith('capture:subscribe');
  });

  it('fetches historical packets on mount when callId query param exists', async () => {
    apiMocks.getCapturePackets.mockResolvedValue([
      {
        id: 'h-1',
        timestamp: '10:00:00.000',
        method: 'INVITE',
        from: 'a',
        to: 'b',
        callId: 'call-123',
        direction: 'in',
        rawJson: '{}',
      },
    ]);

    renderWithRouter(<CapturePage />, { initialEntries: ['/capture?callId=call-123'] });

    await waitFor(() => {
      expect(apiMocks.getCapturePackets).toHaveBeenCalledWith('call-123');
      expect(screen.getByText(/Showing 1 historical packets for call call-123\. Live capture paused\./i)).toBeInTheDocument();
    });
  });

  it('does not fetch historical packets without callId query param', () => {
    renderWithRouter(<CapturePage />, { initialEntries: ['/capture'] });

    expect(apiMocks.getCapturePackets).not.toHaveBeenCalled();
  });

  it('renders live packet row and verdict after selecting a packet', async () => {
    renderWithRouter(<CapturePage />);

    await act(async () => {
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
      await Promise.resolve();
    });

    const row = await screen.findByRole('button', { name: /10:00:01.000/i });
    fireEvent.click(row);

    await waitFor(() => {
      expect(screen.getByText(/no BYE/i)).toBeInTheDocument();
    });
  });

  it('filters packets by method', async () => {
    renderWithRouter(<CapturePage />);

    await act(async () => {
      socketMocks.handlers['sip:packet']?.({ id: '1-0', timestamp: '10:00:00.000', method: 'INVITE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{}' });
      socketMocks.handlers['sip:packet']?.({ id: '2-0', timestamp: '10:00:01.000', method: 'BYE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{}' });
      await Promise.resolve();
    });

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
    renderWithRouter(<CapturePage />);

    await act(async () => {
      socketMocks.handlers['sip:packet']?.({ id: '1-0', timestamp: '10:00:00.000', method: 'INVITE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{"layers":{"sip.Call-ID":["call-1"]}}' });
      await Promise.resolve();
    });

    fireEvent.click(await screen.findByRole('button', { name: /10:00:00.000/i }));
    fireEvent.click(await screen.findByText(/INVITE · 10:00:00.000/i));
    fireEvent.click(await screen.findByRole('button', { name: '[raw]' }));

    const headerMatches = await screen.findAllByText(/sip\.Call-ID/i);
    expect(headerMatches.length).toBeGreaterThan(0);
  });

  it('calls bulk and dialog export endpoints from page actions', async () => {
    renderWithRouter(<CapturePage />);

    await act(async () => {
      socketMocks.handlers['sip:packet']?.({ id: '1-0', timestamp: '10:00:00.000', method: 'INVITE', from: 'a', to: 'b', callId: 'call-1', direction: 'in', rawJson: '{}' });
      await Promise.resolve();
    });
    fireEvent.click(await screen.findByRole('button', { name: /10:00:00.000/i }));

    fireEvent.click(screen.getByRole('button', { name: /^Export \.pcap$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Export this dialog \.pcap$/i }));

    await waitFor(() => {
      expect(apiMocks.exportCaptureBulk).toHaveBeenCalled();
      expect(apiMocks.exportCaptureDialog).toHaveBeenCalledWith('call-1');
    });
  });
});
