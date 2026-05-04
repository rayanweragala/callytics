import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { exportCaptureDialog } from '../../lib/api';
import type { SipPacket } from '../../types';
import { SipHeadersAccordion } from './SipHeadersAccordion';

vi.mock('../../lib/api', () => ({
  exportCaptureDialog: vi.fn(),
}));

function buildPacket(overrides: Partial<SipPacket> = {}): SipPacket {
  return {
    id: overrides.id ?? '1',
    timestamp: overrides.timestamp ?? '10:00:00.000',
    method: overrides.method ?? 'INVITE',
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    callId: overrides.callId ?? 'call-1',
    direction: overrides.direction ?? 'in',
    statusCode: overrides.statusCode,
    rawJson: overrides.rawJson ?? JSON.stringify({
      layers: {
        sip: {
          sip_sip_msg_hdr: 'Via: SIP/2.0/UDP 10.20.115.95:37904;branch=z9hG4bK\r\nFrom: <sip:2001@10.20.115.95:5080>;tag=def0496f\r\nTo: <sip:2001@10.20.115.95:5080>\r\nCall-ID: call-1\r\nCSeq: 216 REGISTER\r\nContent-Type: application/sdp\r\n\r\nv=0\r\no=- 0 0 IN IP4 127.0.0.1',
        },
      },
    }),
  };
}

describe('SipHeadersAccordion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('renders parsed SIP header name/value rows and SDP body section', () => {
    render(<SipHeadersAccordion callId="call-1" packets={[buildPacket()]} />);

    expect(screen.getByText(/INVITE · 10:00:00.000/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/INVITE · 10:00:00.000/i));
    expect(screen.getByText('Via')).toBeInTheDocument();
    expect(screen.getByText(/SIP\/2.0\/UDP 10.20.115.95:37904/i)).toBeInTheDocument();
    expect(screen.getByText('Call-ID')).toBeInTheDocument();
    expect(screen.getByText('call-1')).toBeInTheDocument();
    expect(screen.getByText('SDP Body')).toBeInTheDocument();
    fireEvent.click(screen.getByText('SDP Body'));
    expect(screen.getByText(/v=0/i)).toBeInTheDocument();
  });

  it('toggles raw json block', () => {
    render(<SipHeadersAccordion callId="call-1" packets={[buildPacket()]} />);

    fireEvent.click(screen.getByText(/INVITE · 10:00:00.000/i));
    fireEvent.click(screen.getByRole('button', { name: '[raw]' }));
    expect(screen.getByText(/"sip_sip_msg_hdr"/i)).toBeInTheDocument();
  });

  it('calls export endpoint from header button', async () => {
    (exportCaptureDialog as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Blob(['pcap']));

    render(<SipHeadersAccordion callId="call-export" packets={[buildPacket({ callId: 'call-export' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Export this dialog \.pcap/i }));

    await waitFor(() => {
      expect(exportCaptureDialog).toHaveBeenCalledWith('call-export');
    });
  });

  it('reports export error through callback', async () => {
    const onExportError = vi.fn();
    (exportCaptureDialog as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    render(<SipHeadersAccordion callId="call-export" onExportError={onExportError} packets={[buildPacket({ callId: 'call-export' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Export this dialog \.pcap/i }));

    await waitFor(() => {
      expect(onExportError).toHaveBeenCalled();
    });
  });
});
