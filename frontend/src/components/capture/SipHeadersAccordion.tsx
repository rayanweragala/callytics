import { useState } from 'react';
import { exportCaptureDialog } from '../../lib/api';
import { getApiError } from '../../lib/apiError';
import type { SipPacket } from '../../types';
import styles from './SipHeadersAccordion.module.css';

interface SipHeadersAccordionProps {
  callId: string;
  packets: SipPacket[];
  onExportError?: (message: string) => void;
}

interface ParsedSipContent {
  headers: Array<{ name: string; value: string }>;
  body: string;
}

function parseSipContent(rawJson: string): ParsedSipContent {
  try {
    const raw = JSON.parse(rawJson);
    const msgHdr = String(raw?.layers?.sip?.sip_sip_msg_hdr ?? '');
    const separator = msgHdr.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const separatorIndex = msgHdr.indexOf(separator);
    const headerText = separatorIndex >= 0 ? msgHdr.slice(0, separatorIndex) : msgHdr;
    const bodyText = separatorIndex >= 0 ? msgHdr.slice(separatorIndex + separator.length).trim() : '';

    const headers = headerText
      .split('\r\n')
      .filter((line) => line.includes(':'))
      .map((line) => {
        const colon = line.indexOf(':');
        return {
          name: line.slice(0, colon).trim(),
          value: line.slice(colon + 1).trim(),
        };
      })
      .filter((header) => header.name.length > 0 && header.value.length > 0);

    return { headers, body: bodyText };
  } catch {
    return { headers: [], body: '' };
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function SipHeadersAccordion({ callId, packets, onExportError }: SipHeadersAccordionProps) {
  const [rawOpen, setRawOpen] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState(false);

  return (
    <>
      <div className={styles.dialogHeader}>
        <h3 className={styles.sectionTitle}>SIP Headers</h3>
        <button
          className={styles.actionButton}
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              const blob = await exportCaptureDialog(callId);
              triggerDownload(blob, `callytics-dialog-${callId}.pcap`);
            } catch (error) {
              onExportError?.(getApiError(error, 'failed to export dialog'));
            } finally {
              setExporting(false);
            }
          }}
          type="button"
        >
          {exporting ? 'Exporting…' : 'Export this dialog .pcap'}
        </button>
      </div>

      <div className={styles.accordionList}>
        {packets.map((packet) => {
          const packetKey = `${packet.id}-${packet.timestamp}`;
          const { headers, body } = parseSipContent(packet.rawJson);
          const hasContentType = headers.some((header) => header.name.toLowerCase() === 'content-type');
          const showBody = hasContentType && body.length > 0;

          return (
            <details className={styles.accordionItem} key={packetKey}>
              <summary className={styles.accordionSummary}>{packet.method} · {packet.timestamp}</summary>
              <div className={styles.headerList}>
                {headers.map((header, index) => (
                  <div className={styles.headerRow} key={`${packetKey}-${header.name}-${index}`}>
                    <span className={styles.headerKey}>{header.name}</span>
                    <span className={styles.headerValue}>{header.value}</span>
                  </div>
                ))}

                {showBody ? (
                  <details className={styles.sdpBlock}>
                    <summary className={styles.sdpSummary}>SDP Body</summary>
                    <pre>{body}</pre>
                  </details>
                ) : null}

                <button className={styles.rawButton} onClick={() => setRawOpen((current) => ({ ...current, [packetKey]: !current[packetKey] }))} type="button">[raw]</button>
                {rawOpen[packetKey] ? <pre className={styles.rawJson}>{packet.rawJson}</pre> : null}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
