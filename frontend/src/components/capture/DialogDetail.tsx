import { useMemo, type ReactNode } from 'react';
import { SipLadderPanel } from '../diagnostics/SipLadderPanel';
import { getSipVerdict } from '../../lib/sipVerdict';
import type { SipMessage, SipPacket } from '../../types';
import styles from './DialogDetail.module.css';

interface DialogDetailProps {
  selectedCallId: string | null;
  selectedDialogPackets: SipPacket[];
  activeTab: 'headers' | 'ladder' | 'codecs';
  onActiveTabChange: (tab: 'headers' | 'ladder' | 'codecs') => void;
  children?: ReactNode;
}

interface CodecInfo {
  payload: string;
  name: string;
  display: string;
}

interface ParsedSipContent {
  headers: Array<{ name: string; value: string }>;
  body: string;
}

function verdictIcon(colour: 'green' | 'amber' | 'red'): string {
  if (colour === 'green') {
    return '✓';
  }
  if (colour === 'amber') {
    return '!';
  }
  return '✕';
}

function parseSipContent(rawJson: string): ParsedSipContent {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const layers = root.layers && typeof root.layers === 'object' ? root.layers as Record<string, unknown> : {};
    const sip = layers.sip && typeof layers.sip === 'object' ? layers.sip as Record<string, unknown> : {};
    const msgHdr = String(sip.sip_sip_msg_hdr ?? rawJson);
    const separator = msgHdr.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const separatorIndex = msgHdr.indexOf(separator);
    const headerText = separatorIndex >= 0 ? msgHdr.slice(0, separatorIndex) : msgHdr;
    const body = separatorIndex >= 0 ? msgHdr.slice(separatorIndex + separator.length).trim() : '';
    const headers = headerText
      .split(/\r?\n/)
      .filter((line) => line.includes(':'))
      .map((line) => {
        const colon = line.indexOf(':');
        return { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
      });
    return { headers, body };
  } catch {
    return { headers: [], body: '' };
  }
}

function codecDisplay(name: string): string {
  const normalized = name.toUpperCase();
  if (normalized === 'PCMU') {
    return 'G.711 μ-law';
  }
  if (normalized === 'PCMA') {
    return 'G.711 A-law';
  }
  if (normalized === 'G722') {
    return 'G.722 Wideband';
  }
  if (normalized === 'G729') {
    return 'G.729';
  }
  if (name.toLowerCase() === 'opus') {
    return 'Opus';
  }
  if (name.toLowerCase() === 'telephone-event') {
    return 'DTMF (RFC 2833)';
  }
  return name;
}

function staticPayloadName(payload: string): string | null {
  if (payload === '0') {
    return 'PCMU';
  }
  if (payload === '8') {
    return 'PCMA';
  }
  if (payload === '9') {
    return 'G722';
  }
  if (payload === '18') {
    return 'G729';
  }
  return null;
}

function parseSdpCodecs(body: string): CodecInfo[] {
  if (!body.includes('m=audio')) {
    return [];
  }

  const payloads = new Set<string>();
  const names = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('m=audio')) {
      const parts = trimmed.split(/\s+/).slice(3);
      parts.forEach((payload) => payloads.add(payload));
      continue;
    }
    const rtpMap = trimmed.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/i);
    if (rtpMap?.[1] && rtpMap[2]) {
      names.set(rtpMap[1], rtpMap[2]);
    }
  }

  return Array.from(payloads).map((payload) => {
    const name = names.get(payload) ?? staticPayloadName(payload) ?? payload;
    return { payload, name, display: codecDisplay(name) };
  });
}

function codecKey(codec: CodecInfo): string {
  return codec.name.toLowerCase();
}

function CodecsPane({ packets }: { packets: SipPacket[] }) {
  const offerPacket = packets.find((packet) => parseSipContent(packet.rawJson).body.includes('m=audio'));
  if (!offerPacket) {
    return <div className={styles.codecEmpty}>No SDP in this message</div>;
  }

  const offerBody = parseSipContent(offerPacket.rawJson).body;
  const offered = parseSdpCodecs(offerBody);
  const answerPacket = packets.find((packet) => {
    const code = packet.statusCode ?? Number.parseInt(packet.method, 10);
    return Number.isFinite(code) && code === 200 && parseSipContent(packet.rawJson).body.includes('m=audio');
  });
  const accepted = answerPacket ? parseSdpCodecs(parseSipContent(answerPacket.rawJson).body) : [];
  const acceptedKeys = new Set(accepted.map(codecKey));
  const rejected = answerPacket ? offered.filter((codec) => !acceptedKeys.has(codecKey(codec))) : [];
  const primaryCodec = accepted[0]?.display ?? null;

  return (
    <div className={styles.codecRoot}>
      <div className={styles.codecColumns}>
        <div>
          <div className={styles.codecLabel}>Offered</div>
          <div className={styles.codecPills}>
            {offered.map((codec) => <span className={styles.codecPillNeutral} key={`offered-${codec.payload}-${codec.name}`}>{codec.display}</span>)}
          </div>
        </div>
        <div>
          <div className={styles.codecLabel}>Accepted</div>
          <div className={styles.codecPills}>
            {accepted.map((codec) => <span className={styles.codecPillAccepted} key={`accepted-${codec.payload}-${codec.name}`}>{codec.display}</span>)}
          </div>
        </div>
        <div>
          <div className={styles.codecLabel}>Rejected</div>
          <div className={styles.codecPills}>
            {rejected.map((codec) => <span className={styles.codecPillRejected} key={`rejected-${codec.payload}-${codec.name}`}>{codec.display}</span>)}
          </div>
        </div>
      </div>
      {accepted.length > 0 && primaryCodec ? (
        <div className={styles.codecStatusSuccess}>Negotiation successful — {primaryCodec}</div>
      ) : answerPacket ? (
        <div className={styles.codecStatusError}>No common codec — call will fail</div>
      ) : (
        <div className={styles.codecStatusPending}>Awaiting response</div>
      )}
    </div>
  );
}

export function DialogDetail({ selectedCallId, selectedDialogPackets, activeTab, onActiveTabChange, children }: DialogDetailProps) {

  const ladderMessages = useMemo<SipMessage[]>(() => selectedDialogPackets.map((packet, index) => {
    const numericId = Number.parseInt(packet.id, 10);
    const parsedCode = Number.parseInt(packet.method, 10);

    return {
      id: Number.isFinite(numericId) ? numericId : index + 1,
      callId: packet.callId,
      timestamp: packet.timestamp.includes('T') ? packet.timestamp : `1970-01-01T${packet.timestamp}Z`,
      method: packet.method || null,
      fromUri: packet.from || null,
      toUri: packet.to || null,
      direction: packet.direction === 'out' ? 'outbound' : 'inbound',
      responseCode: packet.statusCode ?? (Number.isFinite(parsedCode) ? parsedCode : null),
      rawMessage: packet.rawJson || null,
      createdAt: null,
    };
  }), [selectedDialogPackets]);

  if (!selectedCallId) {
    return <div className={styles.emptyState}>Select a packet to inspect</div>;
  }

  const verdict = getSipVerdict(selectedDialogPackets);

  return (
    <div className={styles.dialogRoot}>
      <div className={`${styles.verdictBanner} ${verdict.colour === 'green' ? styles.verdictGreen : verdict.colour === 'red' ? styles.verdictRed : styles.verdictAmber}`}>
        <div className={styles.verdictHeader}>
          <span aria-hidden="true" className={styles.verdictIcon}>{verdictIcon(verdict.colour)}</span>
          <div className={styles.verdictMessage}>{verdict.message}</div>
        </div>
        <div className={styles.verdictCause}>{verdict.cause}</div>
      </div>

      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          <button
            aria-selected={activeTab === 'headers'}
            className={`${styles.tabButton} ${activeTab === 'headers' ? styles.tabButtonActive : ''}`}
            onClick={() => onActiveTabChange('headers')}
            role="tab"
            type="button"
          >
            Headers
          </button>
          <button
            aria-selected={activeTab === 'ladder'}
            className={`${styles.tabButton} ${activeTab === 'ladder' ? styles.tabButtonActive : ''}`}
            onClick={() => onActiveTabChange('ladder')}
            role="tab"
            type="button"
          >
            Ladder
          </button>
          <button
            aria-selected={activeTab === 'codecs'}
            className={`${styles.tabButton} ${activeTab === 'codecs' ? styles.tabButtonActive : ''}`}
            onClick={() => onActiveTabChange('codecs')}
            role="tab"
            type="button"
          >
            Codecs
          </button>
        </div>
      </div>

      <div className={styles.tabContent}>
        <div className={`${styles.tabPane} ${styles.headersTabPane} ${activeTab === 'headers' ? styles.tabPaneActive : ''}`}>
          {children}
        </div>
        <div className={`${styles.tabPane} ${styles.ladderTabPane} ${activeTab === 'ladder' ? styles.tabPaneActive : ''}`}>
          <SipLadderPanel callId={selectedCallId} inline messages={ladderMessages.length > 0 ? ladderMessages : undefined} />
        </div>
        <div className={`${styles.tabPane} ${activeTab === 'codecs' ? styles.tabPaneActive : ''}`}>
          <CodecsPane packets={selectedDialogPackets} />
        </div>
      </div>
    </div>
  );
}
