import net from 'node:net';
import { publishSipTraffic, type SipTrafficEvent } from './telemetry';

type AmiMessage = Record<string, string>;

const AMI_HOST = process.env.AMI_HOST || '127.0.0.1';
const AMI_PORT = Number(process.env.AMI_PORT) || 5038;
const AMI_USER = process.env.AMI_USER || 'callytics';
const AMI_PASS = process.env.AMI_PASS || 'callytics';

export function parseAmiMessages(buffer: string): { messages: AmiMessage[]; remainder: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const remainder = parts.pop() || '';
  const messages = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const message: AmiMessage = {};
      for (const line of part.split(/\r?\n/)) {
        const separator = line.indexOf(':');
        if (separator === -1) {
          continue;
        }
        message[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }
      return message;
    });

  return { messages, remainder };
}

export function extractSipTrafficEvent(message: AmiMessage): SipTrafficEvent | null {
  const rawSegments = [
    message.Message,
    message.Output,
    message.Line,
    message.Data,
    message.Verbose,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const rawText = rawSegments.join('\n');
  if (!rawText) {
    return null;
  }

  const fromMatch = rawText.match(/^From:\s*(.+)$/im);
  const toMatch = rawText.match(/^To:\s*(.+)$/im);
  const requestLine = rawText.match(/^(INVITE|REGISTER|OPTIONS|BYE|CANCEL|ACK|PRACK|UPDATE)\s+.+$/im);
  const responseLine = rawText.match(/^SIP\/2\.0\s+(\d{3})\s+(.+)$/im);

  if (!requestLine && !responseLine) {
    return null;
  }

  const method = requestLine ? requestLine[1].toUpperCase() : `${responseLine?.[1] || ''} ${responseLine?.[2] || ''}`.trim();
  const responseCode = responseLine ? Number(responseLine[1]) : null;

  return {
    timestamp: new Date().toISOString(),
    method,
    from: fromMatch?.[1] || 'unknown',
    to: toMatch?.[1] || 'unknown',
    direction: inferDirection(rawText),
    responseCode,
    rawMessage: rawText,
  };
}

function inferDirection(rawText: string): SipTrafficEvent['direction'] {
  const lowered = rawText.toLowerCase();
  if (lowered.includes('transmitting') || lowered.includes('send to')) {
    return 'outbound';
  }
  return 'inbound';
}

export function startSipTrafficMonitor(): void {
  const socket = net.createConnection({ host: AMI_HOST, port: AMI_PORT });
  let buffer = '';
  let loggedIn = false;

  socket.setTimeout(0);

  socket.on('connect', () => {
    socket.write(`Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_PASS}\r\n\r\n`);
  });

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const parsed = parseAmiMessages(buffer);
    buffer = parsed.remainder;

    for (const message of parsed.messages) {
      if (!loggedIn && message.Response === 'Success' && message.Message === 'Authentication accepted') {
        loggedIn = true;
        socket.write('Action: Events\r\nEventMask: on\r\n\r\n');
        socket.write('Action: Command\r\nActionID: sip-logger\r\nCommand: pjsip set logger on\r\n\r\n');
        continue;
      }

      const event = extractSipTrafficEvent(message);
      if (event) {
        void publishSipTraffic(event);
      }
    }
  });

  socket.on('error', (error) => {
    console.error('SIP traffic monitor error:', error);
  });
}
