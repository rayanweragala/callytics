import { useEffect, useMemo, useState } from 'react';
import { getDiagnosticsSipMessagesByCallId } from '../../lib/api';
import type { SipMessage } from '../../types';
import styles from './SipLadderPanel.module.css';

interface SipLadderPanelProps {
  callId: string;
  failedAt?: string;
  errorMessage?: string;
  onClose?: () => void;
  inline?: boolean;
  messages?: SipMessage[];
}

function extractHost(uri: string | null): string | null {
  if (!uri) {
    return null;
  }
  const trimmed = uri.trim();
  const atMatch = trimmed.match(/@([^;>\s]+)/);
  const domainSource = atMatch?.[1] || trimmed.replace(/^<?(?:sip:|sips:)/i, '').replace(/>$/, '');
  const host = domainSource.split(';')[0].split(':')[0].trim();
  return host || null;
}

function formatTime(value: string): string {
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function getMethodColour(method: string | null): string {
  if (!method) {
    return 'var(--text-primary)';
  }
  if (method === 'INVITE') {
    return 'var(--color-info)';
  }
  if (method === 'BYE') {
    return 'var(--color-warning)';
  }
  return 'var(--text-primary)';
}

function getParticipants(messages: SipMessage[]): [string, string] {
  const hosts = new Set<string>();
  for (const message of messages) {
    const fromHost = extractHost(message.fromUri);
    const toHost = extractHost(message.toUri);
    if (fromHost) {
      hosts.add(fromHost);
    }
    if (toHost) {
      hosts.add(toHost);
    }
  }
  if (hosts.size === 2) {
    const values = Array.from(hosts);
    return [values[0], values[1]];
  }
  return ['A', 'B'];
}

export function SipLadderPanel({ callId, failedAt, errorMessage, onClose, inline = false, messages: providedMessages }: SipLadderPanelProps) {
  const [loading, setLoading] = useState(providedMessages === undefined);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SipMessage[]>(providedMessages || []);

  useEffect(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    if (providedMessages !== undefined) {
      setMessages(providedMessages);
      setLoading(false);
      return;
    }

    let mounted = true;
    const loadMessages = async () => {
      setLoading(true);
      try {
        const data = await getDiagnosticsSipMessagesByCallId(callId);
        if (!mounted) {
          return;
        }
        setMessages(data);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadMessages();
    return () => {
      mounted = false;
    };
  }, [callId, providedMessages]);

  const [leftLabel, rightLabel] = useMemo(() => getParticipants(messages), [messages]);
  const failedAtTime = failedAt ? Date.parse(failedAt) : Number.NaN;

  const rowHeight = 40;
  const headerHeight = 60;
  const startY = 70;
  const leftX = 130;
  const rightX = 340;
  const svgHeight = Math.max(200, headerHeight + messages.length * rowHeight + 40);

  const body = (
    <aside className={inline ? styles.inlinePanel : `${styles.panel} ${open ? styles.open : ''}`}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>SIP Ladder</h3>
          <p className={styles.subtitle}>{callId}</p>
        </div>
        {!inline && onClose ? (
          <button aria-label="Close SIP ladder" className={styles.closeButton} onClick={onClose} type="button">×</button>
        ) : null}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : (
        <div className={styles.svgWrap}>
          <svg height={svgHeight} viewBox={`0 0 420 ${svgHeight}`} width="100%" xmlns="http://www.w3.org/2000/svg">
            <text fill="var(--text-secondary)" fontFamily="Space Mono, monospace" fontSize="11" x={leftX - 40} y={24}>{leftLabel}</text>
            <text fill="var(--text-secondary)" fontFamily="Space Mono, monospace" fontSize="11" x={rightX - 50} y={24}>{rightLabel}</text>

            <line stroke="var(--border-default)" strokeWidth="1" x1={leftX} x2={leftX} y1={34} y2={svgHeight - 20} />
            <line stroke="var(--border-default)" strokeWidth="1" x1={rightX} x2={rightX} y1={34} y2={svgHeight - 20} />

            {messages.map((message, index) => {
              const y = startY + index * rowHeight;
              const inbound = message.direction === 'inbound';
              const x1 = inbound ? leftX : rightX;
              const x2 = inbound ? rightX : leftX;
              const label = message.method || (message.responseCode ? String(message.responseCode) : '-');
              const isFailure = Number.isFinite(failedAtTime) && Date.parse(message.timestamp) >= failedAtTime;
              const methodColour = getMethodColour(message.method);
              const color = isFailure ? 'var(--color-error)' : methodColour;
              const head = inbound
                ? `${rightX},${y} ${rightX - 8},${y - 4} ${rightX - 8},${y + 4}`
                : `${leftX},${y} ${leftX + 8},${y - 4} ${leftX + 8},${y + 4}`;

              return (
                <g key={`${message.id}-${message.timestamp}-${index}`}>
                  <text fill="var(--text-muted)" fontFamily="Space Mono, monospace" fontSize="10" x={8} y={y + 3}>{formatTime(message.timestamp)}</text>
                  <line stroke={color} strokeWidth="1" x1={x1} x2={x2} y1={y} y2={y} />
                  <polygon fill={color} points={head} />
                  <text fill={color} fontFamily="Space Mono, monospace" fontSize="11" textAnchor="middle" x={(leftX + rightX) / 2} y={y - 6}>{label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {errorMessage ? <div className={styles.errorBox}>{errorMessage}</div> : null}
    </aside>
  );

  if (inline) {
    return body;
  }

  return <div className={styles.overlay}>{body}</div>;

}
