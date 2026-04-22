import { useMemo, useRef, useState, type ReactNode } from 'react';
import { SipLadderPanel } from '../diagnostics/SipLadderPanel';
import { getSipVerdict } from '../../lib/sipVerdict';
import type { SipMessage, SipPacket } from '../../types';
import styles from './DialogDetail.module.css';

interface DialogDetailProps {
  selectedCallId: string | null;
  selectedDialogPackets: SipPacket[];
  children?: ReactNode;
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

export function DialogDetail({ selectedCallId, selectedDialogPackets, children }: DialogDetailProps) {
  const [activeTab, setActiveTab] = useState<'headers' | 'ladder'>('headers');
  const headersTabRef = useRef<HTMLDivElement | null>(null);

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
            onClick={() => setActiveTab('headers')}
            role="tab"
            type="button"
          >
            Headers
          </button>
          <button
            aria-selected={activeTab === 'ladder'}
            className={`${styles.tabButton} ${activeTab === 'ladder' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('ladder')}
            role="tab"
            type="button"
          >
            Ladder
          </button>
        </div>
        <button
          className={styles.exportButton}
          onClick={() => {
            const exportButton = headersTabRef.current?.querySelector('button');
            if (exportButton instanceof HTMLButtonElement) {
              exportButton.click();
            }
          }}
          type="button"
        >
          Export .pcap ↓
        </button>
      </div>

      <div className={styles.tabContent}>
        <div className={`${styles.tabPane} ${styles.headersTabPane} ${activeTab === 'headers' ? styles.tabPaneActive : ''}`} ref={headersTabRef}>
          {children}
        </div>
        <div className={`${styles.tabPane} ${styles.ladderTabPane} ${activeTab === 'ladder' ? styles.tabPaneActive : ''}`}>
          <SipLadderPanel callId={selectedCallId} inline messages={ladderMessages.length > 0 ? ladderMessages : undefined} />
        </div>
      </div>
    </div>
  );
}
