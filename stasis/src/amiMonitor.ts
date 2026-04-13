import net from 'node:net';
import { publishSipStatus, SipEndpointStatus } from './telemetry';

interface AmiEndpointRow {
  endpoint: string;
  aor: string;
  contacts: string[];
  state: 'registered' | 'unregistered' | 'unknown';
}

interface AmiMessage {
  [key: string]: string;
}

const AMI_HOST = process.env.AMI_HOST || '127.0.0.1';
const AMI_PORT = Number(process.env.AMI_PORT) || 5038;
const AMI_USER = process.env.AMI_USER || 'callytics';
const AMI_PASS = process.env.AMI_PASS || 'callytics';

function parseMessages(buffer: string): { messages: AmiMessage[]; remainder: string } {
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
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        message[key] = value;
      }
      return message;
    });

  return { messages, remainder };
}

async function pollEndpoints(): Promise<AmiEndpointRow[]> {
  return new Promise((resolve, reject) => {
    const actionId = `diag-${Date.now()}`;
    const socket = net.createConnection({ host: AMI_HOST, port: AMI_PORT });
    const endpoints: AmiEndpointRow[] = [];
    let buffer = '';
    let loggedIn = false;
    let resolved = false;

    const finalize = (handler: () => void) => {
      if (resolved) {
        return;
      }
      resolved = true;
      socket.end();
      handler();
    };

    socket.setTimeout(5000, () => finalize(() => reject(new Error('AMI timeout'))));
    socket.on('error', (error) => finalize(() => reject(error)));

    socket.on('connect', () => {
      socket.write(
        `Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_PASS}\r\n\r\n`,
      );
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const parsed = parseMessages(buffer);
      buffer = parsed.remainder;

      for (const message of parsed.messages) {
        if (!loggedIn && message.Response === 'Success' && message.Message === 'Authentication accepted') {
          loggedIn = true;
          socket.write(`Action: PJSIPShowEndpoints\r\nActionID: ${actionId}\r\n\r\n`);
          continue;
        }

        if (message.Event === 'EndpointList' && message.ActionID === actionId) {
          const contacts = (message.Contacts || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

          endpoints.push({
            endpoint: message.ObjectName || 'unknown',
            aor: message.Aor || 'unknown',
            contacts,
            state: contacts.length > 0 ? 'registered' : 'unregistered',
          });
          continue;
        }

        if (message.Event === 'EndpointListComplete' && message.ActionID === actionId) {
          socket.write('Action: Logoff\r\n\r\n');
          finalize(() => resolve(endpoints));
          return;
        }
      }
    });
  });
}

export function startAmiMonitor(): void {
  const run = async () => {
    try {
      const endpoints = await pollEndpoints();
      await publishSipStatus(
        endpoints.map((endpoint) => ({
          endpoint: endpoint.endpoint,
          aor: endpoint.aor,
          contacts: endpoint.contacts,
          state: endpoint.state,
          updatedAt: Date.now(),
        } satisfies SipEndpointStatus)),
      );
    } catch (error) {
      console.error('AMI monitor error:', error);
      await publishSipStatus([
        {
          endpoint: 'AMI',
          aor: 'AMI',
          contacts: [],
          state: 'unknown',
          updatedAt: Date.now(),
        },
      ]);
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, 5000);
}
