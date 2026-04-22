import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SipLadderPanel } from './SipLadderPanel';
import { getDiagnosticsSipMessagesByCallId } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getDiagnosticsSipMessagesByCallId: vi.fn(),
}));

describe('SipLadderDiagram (SipLadderPanel SVG)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an SVG and SIP method labels for a call id', async () => {
    vi.mocked(getDiagnosticsSipMessagesByCallId).mockResolvedValue([
      { id: 1, callId: 'abc-123', timestamp: '2026-04-21T20:00:00.000Z', method: 'INVITE', fromUri: 'sip:1001@a.local', toUri: 'sip:2001@b.local', direction: 'inbound', responseCode: null, rawMessage: 'invite', createdAt: null },
      { id: 2, callId: 'abc-123', timestamp: '2026-04-21T20:00:01.000Z', method: '100', fromUri: 'sip:2001@b.local', toUri: 'sip:1001@a.local', direction: 'outbound', responseCode: 100, rawMessage: '100', createdAt: null },
      { id: 3, callId: 'abc-123', timestamp: '2026-04-21T20:00:02.000Z', method: '180', fromUri: 'sip:2001@b.local', toUri: 'sip:1001@a.local', direction: 'outbound', responseCode: 180, rawMessage: '180', createdAt: null },
      { id: 4, callId: 'abc-123', timestamp: '2026-04-21T20:00:03.000Z', method: '200', fromUri: 'sip:2001@b.local', toUri: 'sip:1001@a.local', direction: 'outbound', responseCode: 200, rawMessage: '200', createdAt: null },
      { id: 5, callId: 'abc-123', timestamp: '2026-04-21T20:00:04.000Z', method: 'ACK', fromUri: 'sip:1001@a.local', toUri: 'sip:2001@b.local', direction: 'inbound', responseCode: null, rawMessage: 'ack', createdAt: null },
      { id: 6, callId: 'abc-123', timestamp: '2026-04-21T20:00:05.000Z', method: 'BYE', fromUri: 'sip:1001@a.local', toUri: 'sip:2001@b.local', direction: 'inbound', responseCode: null, rawMessage: 'bye', createdAt: null },
    ]);

    const { container } = render(<SipLadderPanel callId="abc-123" onClose={() => {}} />);

    await waitFor(() => expect(getDiagnosticsSipMessagesByCallId).toHaveBeenCalledWith('abc-123'));

    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(screen.getByText('INVITE')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('ACK')).toBeInTheDocument();
    expect(screen.getByText('BYE')).toBeInTheDocument();
  });

  it('renders messages in ascending timestamp order (earliest at top)', async () => {
    vi.mocked(getDiagnosticsSipMessagesByCallId).mockResolvedValue([
      { id: 10, callId: 'abc-123', timestamp: '2026-04-21T20:00:00.000Z', method: 'INVITE', fromUri: null, toUri: null, direction: 'inbound', responseCode: null, rawMessage: null, createdAt: null },
      { id: 11, callId: 'abc-123', timestamp: '2026-04-21T20:00:01.000Z', method: '180', fromUri: null, toUri: null, direction: 'outbound', responseCode: 180, rawMessage: null, createdAt: null },
      { id: 12, callId: 'abc-123', timestamp: '2026-04-21T20:00:02.000Z', method: 'BYE', fromUri: null, toUri: null, direction: 'inbound', responseCode: null, rawMessage: null, createdAt: null },
    ]);

    render(<SipLadderPanel callId="abc-123" onClose={() => {}} />);

    const invite = await screen.findByText('INVITE');
    const ringing = await screen.findByText('180');
    const bye = await screen.findByText('BYE');

    const inviteY = Number(invite.getAttribute('y'));
    const ringingY = Number(ringing.getAttribute('y'));
    const byeY = Number(bye.getAttribute('y'));

    expect(inviteY).toBeLessThan(ringingY);
    expect(ringingY).toBeLessThan(byeY);
  });

  it('highlights failure path when failedAt matches later message timestamps', async () => {
    vi.mocked(getDiagnosticsSipMessagesByCallId).mockResolvedValue([
      { id: 20, callId: 'abc-123', timestamp: '2026-04-21T20:00:00.000Z', method: 'INVITE', fromUri: null, toUri: null, direction: 'inbound', responseCode: null, rawMessage: null, createdAt: null },
      { id: 21, callId: 'abc-123', timestamp: '2026-04-21T20:00:05.000Z', method: '486', fromUri: null, toUri: null, direction: 'outbound', responseCode: 486, rawMessage: null, createdAt: null },
    ]);

    const { container } = render(
      <SipLadderPanel
        callId="abc-123"
        failedAt="2026-04-21T20:00:04.000Z"
        onClose={() => {}}
      />,
    );

    await screen.findByText('486');

    const errorStrokes = container.querySelectorAll('line[stroke="var(--color-error)"]');
    expect(errorStrokes.length).toBeGreaterThan(0);
  });

  it('renders without crashing for empty messages', async () => {
    vi.mocked(getDiagnosticsSipMessagesByCallId).mockResolvedValue([]);

    const { container } = render(<SipLadderPanel callId="abc-123" onClose={() => {}} />);

    await waitFor(() => expect(getDiagnosticsSipMessagesByCallId).toHaveBeenCalled());
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
