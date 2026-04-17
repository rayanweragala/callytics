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
      Message: 'Transmitting\nINVITE sip:trunk@example.com SIP/2.0\nFrom: 1001\nTo: trunk',
    });

    expect(event).toEqual(expect.objectContaining({
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
});
