import { extractSipTrafficEvent, parseAmiMessages } from './sipTrafficMonitor';

describe('sipTrafficMonitor', () => {
  it('parses AMI messages from a streaming buffer', () => {
    const result = parseAmiMessages(
      'Event: Verbose\r\nMessage: hello\r\n\r\nEvent: Verbose\r\nMessage: world\r\n\r\npartial',
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].Message).toBe('hello');
    expect(result.remainder).toBe('Event: Verbose\r\nMessage: world\r\n\r\npartial');
  });

  it('keeps RTCP report fields inside the same AMI message when a blank line appears mid-event', () => {
    const result = parseAmiMessages(
      [
        'Event: RTCPReceived',
        'Uniqueid: 1746173048.12',
        'Channel: PJSIP/2001-00000001',
        '',
        'Report0IAJitter: 42',
        'Report0FractionLost: 3',
        '',
        'Event: Hangup',
        'Channel: PJSIP/2001-00000001',
        '',
        'Event: FullyBooted',
        'Status: Fully Booted',
        '',
      ].join('\r\n'),
    );

    expect(result.remainder).toBe('Event: FullyBooted\r\nStatus: Fully Booted');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(expect.objectContaining({
      Event: 'RTCPReceived',
      Uniqueid: '1746173048.12',
      Report0IAJitter: '42',
      Report0FractionLost: '3',
    }));
    expect(result.messages[1]).toEqual(expect.objectContaining({
      Event: 'Hangup',
      Channel: 'PJSIP/2001-00000001',
    }));
  });

  it('defers a terminated RTCP header block until report fields arrive in a later chunk', () => {
    const first = parseAmiMessages(
      [
        'Event: RTCPSent',
        'Uniqueid: 1746173048.12',
        'SentPackets: 1250',
        'SentOctets: 200000',
        '',
        '',
      ].join('\r\n'),
    );

    expect(first.messages).toHaveLength(0);
    expect(first.remainder).toBe([
      'Event: RTCPSent',
      'Uniqueid: 1746173048.12',
      'SentPackets: 1250',
      'SentOctets: 200000',
    ].join('\r\n'));

    const second = parseAmiMessages(
      `${first.remainder}\r\n\r\n${[
        'Report0SourceSSRC: 0x15a565e4',
        'Report0FractionLost: 0',
        'Report0IAJitter: 193',
        '',
        'Event: Hangup',
        'Channel: PJSIP/2001-00000001',
        '',
      ].join('\r\n')}`,
    );

    expect(second.messages).toHaveLength(1);
    expect(second.messages[0]).toEqual(expect.objectContaining({
      Event: 'RTCPSent',
      Uniqueid: '1746173048.12',
      Report0SourceSSRC: '0x15a565e4',
      Report0FractionLost: '0',
      Report0IAJitter: '193',
    }));
    expect(second.remainder).toBe('Event: Hangup\r\nChannel: PJSIP/2001-00000001');
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
