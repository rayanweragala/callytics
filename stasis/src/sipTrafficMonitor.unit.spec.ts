import { extractSipTrafficEvent, parseAmiMessages } from './sipTrafficMonitor';

describe('sipTrafficMonitor', () => {
  it('parses AMI messages from a streaming buffer', () => {
    const result = parseAmiMessages(
      'Event: Verbose\r\nMessage: hello\r\n\r\nEvent: Verbose\r\nMessage: world\r\n\r\npartial',
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].Message).toBe('hello');
    expect(result.remainder).toBe('partial');
  });

  it('extracts SIP request traffic from AMI event objects', () => {
    const event = extractSipTrafficEvent({
      Event: 'Verbose',
      Message: 'Transmitting\nINVITE sip:trunk@example.com SIP/2.0\nCall-ID: abc-123@example.com\nFrom: 1001\nTo: trunk',
    });

    expect(event).toEqual(expect.objectContaining({
      callId: 'abc-123@example.com',
      method: 'INVITE',
      from: '1001',
      to: 'trunk',
      direction: 'outbound',
      responseCode: null,
    }));
  });

  it('extracts SIP response traffic from AMI event objects', () => {
    const event = extractSipTrafficEvent({
      Event: 'Verbose',
      Message: 'Received\nSIP/2.0 486 Busy Here\nFrom: trunk\nTo: 1001',
    });

    expect(event).toEqual(expect.objectContaining({
      method: '486 Busy Here',
      from: 'trunk',
      to: '1001',
      direction: 'inbound',
      responseCode: 486,
    }));
  });

  it('ignores unrelated AMI events', () => {
    expect(extractSipTrafficEvent({ Event: 'Hangup', Message: 'Channel closed' })).toBeNull();
  });

  it('extracts Call-ID when present in raw SIP invite', () => {
    const event = extractSipTrafficEvent({
      Event: 'Verbose',
      Message: 'INVITE sip:2001@example.com SIP/2.0\nCall-ID: abc-123-xyz\nFrom: <sip:1001@example.com>\nTo: <sip:2001@example.com>',
    });

    expect(event?.callId).toBe('abc-123-xyz');
  });

  it('returns null callId when raw SIP message has no Call-ID header', () => {
    const event = extractSipTrafficEvent({
      Event: 'Verbose',
      Message: 'INVITE sip:2001@example.com SIP/2.0\nFrom: <sip:1001@example.com>\nTo: <sip:2001@example.com>',
    });

    expect(event?.callId).toBeNull();
  });

  it('extracts Call-ID when the header appears mid-message', () => {
    const event = extractSipTrafficEvent({
      Event: 'Verbose',
      Message: [
        'INVITE sip:2001@example.com SIP/2.0',
        'Via: SIP/2.0/UDP 10.0.0.1;branch=z9hG4bK-1',
        'From: <sip:1001@example.com>;tag=a73kszlfl',
        'To: <sip:2001@example.com>',
        'Call-ID: abc-123-xyz',
        'CSeq: 1 INVITE',
      ].join('\n'),
    });

    expect(event?.callId).toBe('abc-123-xyz');
  });

  it('returns null callId for empty raw SIP payload', () => {
    const event = extractSipTrafficEvent({ Event: 'Verbose', Message: '' });

    expect(event).toBeNull();
  });
});
