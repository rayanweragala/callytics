import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LiveDot } from '../components/LiveDot';
import { PageLayout } from '../components/common/PageLayout';
import { DialogDetail } from '../components/capture/DialogDetail';
import { PacketStream, type PacketStreamFilters } from '../components/capture/PacketStream';
import { SipHeadersAccordion } from '../components/capture/SipHeadersAccordion';
import { exportCaptureBulk, getCapturePackets } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { diagnosticsSocket } from '../lib/socket';
import type { SipPacket } from '../types';
import styles from './CapturePage.module.css';

function packetTimeValue(packet: SipPacket): number {
  const [hms = '00:00:00', ms = '000'] = packet.timestamp.split('.');
  const [h = '0', m = '0', s = '0'] = hms.split(':');
  return (Number(h) * 3600 * 1000) + (Number(m) * 60 * 1000) + (Number(s) * 1000) + Number(ms);
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

export function CapturePage() {
  const [searchParams] = useSearchParams();
  const [packets, setPackets] = useState<SipPacket[]>([]);
  const [paused, setPaused] = useState(false);
  const [filters, setFilters] = useState<PacketStreamFilters>({
    method: 'all',
    callId: '',
    endpoint: null,
    from: '',
    to: '',
  });
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [exportingBulk, setExportingBulk] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(38);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    const callIdParam = searchParams.get('callId');
    if (!callIdParam) {
      setInfoBanner(null);
      return;
    }

    let active = true;

    const loadHistorical = async () => {
      setPageError(null);
      try {
        const historicalPackets = await getCapturePackets(callIdParam);
        if (!active) {
          return;
        }

        if (historicalPackets.length > 0) {
          const sipCallId = historicalPackets[0]?.callId ?? '';
          setPackets(historicalPackets);
          setPaused(true);
          setFilters((prev) => ({ ...prev, callId: sipCallId }));
          setSelectedCallId(sipCallId);
          setInfoBanner(`Showing ${historicalPackets.length} historical packets for call ${callIdParam}. Live capture paused.`);
          return;
        }

        setInfoBanner(`Showing 0 historical packets for call ${callIdParam}. Live capture paused.`);
      } catch (error) {
        if (!active) {
          return;
        }
        setInfoBanner(null);
        setPageError(getApiError(error, 'failed to load historical capture packets'));
      } finally {
        if (active) {
          setPaused(true);
        }
      }
    };

    void loadHistorical();
    return () => {
      active = false;
    };
  }, [searchParams]);

  useEffect(() => {
    const onPacket = (packet: SipPacket) => {
      if (paused) {
        return;
      }
      setPackets((current) => [packet, ...current].slice(0, 500));
    };

    const onConnect = () => {
      diagnosticsSocket.emit('capture:subscribe');
    };

    if (diagnosticsSocket.connected) {
      diagnosticsSocket.emit('capture:subscribe');
    }

    diagnosticsSocket.on('connect', onConnect);
    diagnosticsSocket.on('sip:packet', onPacket);

    return () => {
      diagnosticsSocket.emit('capture:unsubscribe');
      diagnosticsSocket.off('connect', onConnect);
      diagnosticsSocket.off('sip:packet', onPacket);
    };
  }, [paused]);

  const updatePanelWidthFromClientX = useCallback((clientX: number) => {
    const container = splitLayoutRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const minLeftPercent = (280 / rect.width) * 100;
    const maxLeftPercent = 60;
    const rawPercent = ((clientX - rect.left) / rect.width) * 100;
    const nextPercent = Math.min(maxLeftPercent, Math.max(minLeftPercent, rawPercent));
    setLeftPanelWidth(nextPercent);
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!resizingRef.current) {
        return;
      }
      updatePanelWidthFromClientX(event.clientX);
    };

    const handleMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [updatePanelWidthFromClientX]);

  const handleSplitMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    updatePanelWidthFromClientX(event.clientX);
  };

  const selectedDialogPackets = useMemo(() => {
    if (!selectedCallId) {
      return [] as SipPacket[];
    }
    return packets
      .filter((packet) => packet.callId === selectedCallId)
      .slice()
      .sort((a, b) => packetTimeValue(a) - packetTimeValue(b));
  }, [packets, selectedCallId]);

  const statusText = `source: tshark -i any | packets: ${packets.length} | buffer: ${Math.round((packets.length / 500) * 100)}%`;

  const actions = (
    <div className={styles.actions}>
      <span className={styles.liveIndicator}><LiveDot active={!paused} />live</span>
      <button className={styles.actionButton} onClick={() => setPaused((value) => !value)} type="button">{paused ? 'Resume' : 'Pause'}</button>
      <button className={styles.actionButton} onClick={() => { setPackets([]); setSelectedCallId(null); }} type="button">Clear</button>
      <button
        className={styles.actionButton}
        disabled={exportingBulk}
        onClick={async () => {
          setExportingBulk(true);
          try {
            const blob = await exportCaptureBulk({
              method: filters.method,
              callId: filters.callId || undefined,
              endpoint: filters.endpoint || undefined,
              from: filters.from || undefined,
              to: filters.to || undefined,
            });
            triggerDownload(blob, 'callytics-capture-export.pcap');
          } catch (error) {
            setPageError(getApiError(error, 'failed to export capture'));
          } finally {
            setExportingBulk(false);
          }
        }}
        type="button"
      >
        {exportingBulk ? 'Exporting…' : 'Export .pcap'}
      </button>
    </div>
  );

  return (
    <PageLayout actions={actions} subtitle="monitor" title="Capture">
      <div className={styles.page}>
        {pageError ? <div className={styles.errorText}>{pageError}</div> : null}
        {infoBanner ? <div className={styles.statusLine}>{infoBanner}</div> : null}
        <div className={styles.statusLine}>{statusText}</div>

        <div
          className={`${styles.splitLayout} ${selectedCallId ? styles.hasSelection : ''}`}
          ref={splitLayoutRef}
          style={{ '--capture-left-width': `${leftPanelWidth}%` } as CSSProperties}
        >
          <PacketStream
            filters={filters}
            onFiltersChange={setFilters}
            onSelectCallId={setSelectedCallId}
            packets={packets}
            selectedCallId={selectedCallId}
          />

          <div
            aria-label="Resize capture panels"
            aria-orientation="vertical"
            className={styles.splitHandle}
            onMouseDown={handleSplitMouseDown}
            role="separator"
          />

          <section className={styles.rightPanel}>
            <DialogDetail selectedCallId={selectedCallId} selectedDialogPackets={selectedDialogPackets}>
              {selectedCallId ? (
                <SipHeadersAccordion
                  callId={selectedCallId}
                  onExportError={(message) => setPageError(message)}
                  packets={selectedDialogPackets}
                />
              ) : null}
            </DialogDetail>
          </section>
        </div>
      </div>
    </PageLayout>
  );
}
