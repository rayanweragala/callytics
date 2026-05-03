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

function extractSipIdentity(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const uriMatch = trimmed.match(/(?:sip:|sips:|tel:)([^>\s;]+)/i);
  const uriPart = uriMatch?.[1] || trimmed;
  const atIndex = uriPart.indexOf('@');
  if (atIndex > 0) {
    const user = uriPart.slice(0, atIndex).trim().replace(/^"+|"+$/g, '');
    if (user) {
      return user;
    }
  }

  const hostOnly = uriPart
    .replace(/^"+|"+$/g, '')
    .replace(/^<?(?:sip:|sips:|tel:)/i, '')
    .split(';')[0]
    .split('>')[0]
    .trim();
  if (!hostOnly) {
    return null;
  }
  return hostOnly.split(':')[0] || null;
}

function parseFromHeader(rawMessage: string | null): string | null {
  if (!rawMessage) {
    return null;
  }
  const lines = rawMessage.split(/\r?\n/);
  const fromLine = lines.find((line) => /^from\s*:/i.test(line) || /^f\s*:/i.test(line));
  if (!fromLine) {
    return null;
  }
  const headerValue = fromLine.replace(/^[^:]*:/, '').trim();
  return extractSipIdentity(headerValue);
}

function formatTime(value: string): string {
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function getArrowColorClass(message: SipMessage, isFailure: boolean): string {
  if (isFailure) return styles.arrowError;

  const code = message.responseCode;
  if (code !== null && code !== undefined) {
    if (code >= 200 && code < 300) return styles.arrowSuccess;
    if (code >= 400 && code < 500) return styles.arrowWarning;
    if (code >= 500) return styles.arrowError;
    return styles.arrowData; // 1xx/3xx
  }

  const method = message.method;
  if (!method) return styles.arrowMuted;
  if (method === 'INVITE') return styles.arrowInvite;
  if (method === 'BYE' || method === 'CANCEL') return styles.arrowError;
  if (method === 'REGISTER') return styles.arrowData;
  if (method === 'ACK' || method === 'OPTIONS') return styles.arrowMuted;
  return styles.arrowMuted;
}

function isResponseMessage(message: SipMessage): boolean {
  return message.responseCode !== null && message.responseCode !== undefined;
}

function getParticipants(messages: SipMessage[]): [string, string] {
  const first = messages[0];
  if (!first) {
    return ['Caller', 'Asterisk'];
  }
  const fromIdentity = parseFromHeader(first.rawMessage) || extractSipIdentity(first.fromUri) || 'Caller';
  return [fromIdentity, 'Asterisk'];
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
            {/* Participant labels */}
            <text className={styles.participantLabel} fontFamily="Space Mono, monospace" fontSize="11" x={leftX - 40} y={24}>{leftLabel}</text>
            <text className={styles.participantLabel} fontFamily="Space Mono, monospace" fontSize="11" x={rightX - 50} y={24}>{rightLabel}</text>

            {/* Vertical lifelines */}
            <line className={styles.lifeline} strokeWidth="1" x1={leftX} x2={leftX} y1={34} y2={svgHeight - 20} />
            <line className={styles.lifeline} strokeWidth="1" x1={rightX} x2={rightX} y1={34} y2={svgHeight - 20} />

            {messages.map((message, index) => {
              const y = startY + index * rowHeight;
              const inbound = message.direction === 'inbound';
              const x1 = inbound ? leftX : rightX;
              const x2 = inbound ? rightX : leftX;
              const label = message.method || (message.responseCode ? String(message.responseCode) : '-');
              const isFailure = Number.isFinite(failedAtTime) && Date.parse(message.timestamp) >= failedAtTime;
              const colorClass = getArrowColorClass(message, isFailure);
              const isResponse = isResponseMessage(message);

              const head = inbound
                ? `${rightX},${y} ${rightX - 8},${y - 4} ${rightX - 8},${y + 4}`
                : `${leftX},${y} ${leftX + 8},${y - 4} ${leftX + 8},${y + 4}`;

              return (
                <g className={colorClass} key={`${message.id}-${message.timestamp}-${index}`}>
                  <text className={styles.timestampLabel} fontFamily="Space Mono, monospace" fontSize="10" x={8} y={y + 3}>{formatTime(message.timestamp)}</text>
                  <line
                    className={isResponse ? styles.arrowLineDashed : styles.arrowLine}
                    strokeWidth="1"
                    x1={x1}
                    x2={x2}
                    y1={y}
                    y2={y}
                  />
                  <polygon className={styles.arrowHead} points={head} />
                  <text className={styles.arrowLabel} fontFamily="Space Mono, monospace" fontSize="11" textAnchor="middle" x={(leftX + rightX) / 2} y={y - 6}>{label}</text>
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
