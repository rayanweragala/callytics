import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LiveDot } from '../components/LiveDot';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { DialogDetail } from '../components/capture/DialogDetail';
import { PacketStream, type PacketStreamFilters } from '../components/capture/PacketStream';
import { SipHeadersAccordion } from '../components/capture/SipHeadersAccordion';
import { exportCaptureBulk, getCapturePackets } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { diagnosticsSocket } from '../lib/socket';
import { formatPacketTimestamp } from '../lib/time';
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

interface SipCodeInfo {
  title: string;
  explanation: string;
}

const SIP_CODE_INFO: Record<number, SipCodeInfo> = {
  100: { title: 'Processing', explanation: 'Request received, searching for destination. Not an error.' },
  200: { title: 'Success', explanation: 'Request accepted. For INVITE this means call connected.' },
  202: { title: 'Accepted', explanation: 'Request accepted for processing, not yet completed.' },
  301: { title: 'Moved Permanently', explanation: 'Endpoint has a new permanent address. Update your config.' },
  302: { title: 'Moved Temporarily', explanation: 'Endpoint temporarily at a different address.' },
  400: { title: 'Bad Request', explanation: 'Malformed SIP message. Check headers and syntax.' },
  401: { title: 'Authentication Challenge', explanation: 'Normal if followed by retry with credentials. Problem if repeated without resolution.' },
  403: { title: 'Forbidden', explanation: 'Credentials rejected or IP not authorized. Check username, password, and IP whitelist.' },
  404: { title: 'Not Found', explanation: 'Destination extension or URI does not exist on this server.' },
  407: { title: 'Proxy Auth Required', explanation: 'Proxy is demanding credentials. Check trunk authentication config.' },
  408: { title: 'Request Timeout', explanation: 'No response from destination. Check network connectivity and firewall rules.' },
  480: { title: 'Temporarily Unavailable', explanation: 'Endpoint exists but is not currently reachable. May be offline or busy.' },
  481: { title: 'Call Leg Does Not Exist', explanation: 'Transaction or dialog not found. Often a timing issue on BYE or CANCEL.' },
  486: { title: 'Busy Here', explanation: 'Endpoint is busy. Expected on busy extensions.' },
  487: { title: 'Request Terminated', explanation: 'Call was cancelled before answer. Normal on user-initiated cancel.' },
  488: { title: 'Not Acceptable Here', explanation: 'Codec or media mismatch. Check SDP offer and accepted codecs on both sides.' },
  500: { title: 'Server Internal Error', explanation: 'Asterisk encountered an unexpected error. Check Asterisk logs.' },
  503: { title: 'Service Unavailable', explanation: 'Server overloaded or temporarily down.' },
  504: { title: 'Server Timeout', explanation: 'Upstream server did not respond in time.' },
  600: { title: 'Busy Everywhere', explanation: 'All endpoints for this destination are busy.' },
  603: { title: 'Decline', explanation: 'Destination explicitly rejected the call. Check inbound route configuration.' },
};

function getSipCodeInfo(code: number): SipCodeInfo {
  return SIP_CODE_INFO[code] ?? {
    title: 'Unknown Response',
    explanation: 'No description available for this code.',
  };
}

function getTooltipCodeClass(code: number): string {
  if (code >= 200 && code < 300) return styles.codeInfo2xx;
  if (code >= 400 && code < 500) return styles.codeInfo4xx;
  if (code >= 500) return styles.codeInfo5xx;
  return styles.codeInfo1xx;
}

interface DiffLine {
  key: string;
  left: string | null;
  right: string | null;
  state: 'same' | 'different' | 'leftOnly' | 'rightOnly';
}

interface ParsedSipContent {
  headers: Array<{ name: string; value: string }>;
  body: string;
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
      })
      .filter((h) => h.name.length > 0);
    return { headers, body };
  } catch {
    return { headers: [], body: '' };
  }
}

function buildDiffLines(leftPacket: SipPacket, rightPacket: SipPacket): DiffLine[] {
  const leftHeaders = parseSipContent(leftPacket.rawJson).headers;
  const rightHeaders = parseSipContent(rightPacket.rawJson).headers;
  const keys = Array.from(new Set([...leftHeaders.map((h) => h.name), ...rightHeaders.map((h) => h.name)]));
  return keys.map((key) => {
    const left = leftHeaders.find((h) => h.name === key)?.value ?? null;
    const right = rightHeaders.find((h) => h.name === key)?.value ?? null;
    if (left !== null && right !== null && left === right) return { key, left, right, state: 'same' };
    if (left !== null && right !== null) return { key, left, right, state: 'different' };
    if (left !== null) return { key, left, right, state: 'leftOnly' };
    return { key, left, right, state: 'rightOnly' };
  });
}

interface TooltipState {
  code: number | null;
  x: number;
  y: number;
}

const HOVER_DELAY_MS = 150;

export function CapturePage() {
  const [searchParams] = useSearchParams();
  const [packets, setPackets] = useState<SipPacket[]>([]);
  const [paused, setPaused] = useState(false);
  const [viewMode, setViewMode] = useState<'stream' | 'dialog'>('stream');
  const [detailTab, setDetailTab] = useState<'headers' | 'ladder' | 'codecs'>('headers');
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
  const [leftPanelWidth, setLeftPanelWidth] = useState(58);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const resizingRef = useRef(false);

  const [tooltip, setTooltip] = useState<TooltipState>({ code: null, x: 0, y: 0 });
  const tooltipTimerRef = useRef<number | null>(null);

  const [checkedPacketIds, setCheckedPacketIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const diffPanelRef = useRef<HTMLDivElement | null>(null);

  const checkedPackets = useMemo(() =>
    checkedPacketIds
      .map((id) => packets.find((p) => p.id === id))
      .filter((p): p is SipPacket => Boolean(p)),
    [checkedPacketIds, packets]
  );

  const diffLines = useMemo(() =>
    checkedPackets.length === 2 ? buildDiffLines(checkedPackets[0], checkedPackets[1]) : [],
    [checkedPackets]
  );

  useEffect(() => {
    if (!compareOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      diffPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [compareOpen]);

  const handleTooltipShow = useCallback((code: number, x: number, y: number) => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current);
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltip({ code, x, y });
    }, HOVER_DELAY_MS);
  }, []);

  const handleTooltipHide = useCallback(() => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip({ code: null, x: 0, y: 0 });
  }, []);

  useEffect(() => {
    splitLayoutRef.current?.style.setProperty('--capture-left-width', `${leftPanelWidth}%`);
  }, [leftPanelWidth]);

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

  const handleSelectCallId = useCallback((callId: string, preferredTab?: 'headers' | 'ladder' | 'codecs') => {
    setSelectedCallId(callId);
    if (preferredTab) {
      setDetailTab(preferredTab);
    }
  }, []);

  const closeCompare = () => {
    setCompareOpen(false);
    setCheckedPacketIds([]);
  };

  const diffRowClass = (state: DiffLine['state']): string => {
    if (state === 'same') return styles.rowSame;
    if (state === 'different') return styles.rowDiff;
    if (state === 'leftOnly') return styles.rowLeftOnly;
    return styles.rowRightOnly;
  };

  const actions = (
    <div className={styles.actions}>
      <span className={styles.liveIndicator}><LiveDot active={!paused} />live</span>
      <button className={styles.actionButton} onClick={() => setPaused((value) => !value)} type="button">{paused ? 'Resume' : 'Pause'}</button>
      <button className={styles.actionButton} onClick={() => { setPackets([]); setSelectedCallId(null); setDetailTab('headers'); }} type="button">Clear</button>
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
      <div className={styles.viewToggle} aria-label="capture view mode">
        <button
          className={`${styles.viewToggleButton} ${viewMode === 'stream' ? styles.viewToggleActive : ''}`}
          onClick={() => setViewMode('stream')}
          type="button"
        >
          ≡ Stream
        </button>
        <button
          className={`${styles.viewToggleButton} ${viewMode === 'dialog' ? styles.viewToggleActive : ''}`}
          onClick={() => setViewMode('dialog')}
          type="button"
        >
          ⋮⋮ Dialog
        </button>
      </div>
    </div>
  );

  return (
    <PageLayout actions={actions} subtitle="monitor" title="Capture">
      <div className={styles.page}>
        {pageError ? <ErrorMessage message={pageError} /> : null}
        {infoBanner ? <div className={styles.statusLine}>{infoBanner}</div> : null}
        <div className={styles.statusLine}>{statusText}</div>

        <div
          className={`${styles.splitLayout} ${selectedCallId ? styles.hasSelection : ''}`}
          ref={splitLayoutRef}
        >
          <PacketStream
            checkedPacketIds={checkedPacketIds}
            compareOpen={compareOpen}
            filters={filters}
            onCheckedPacketIdsChange={setCheckedPacketIds}
            onCodeHoverHide={handleTooltipHide}
            onCodeHoverShow={handleTooltipShow}
            onCompareOpen={() => setCompareOpen(true)}
            onFiltersChange={setFilters}
            onSelectCallId={handleSelectCallId}
            packets={packets}
            selectedCallId={selectedCallId}
            viewMode={viewMode}
          />

          <div
            aria-label="Resize capture panels"
            aria-orientation="vertical"
            className={styles.splitHandle}
            onMouseDown={handleSplitMouseDown}
            role="separator"
          />

          <section className={styles.rightPanel}>
            <DialogDetail activeTab={detailTab} onActiveTabChange={setDetailTab} selectedCallId={selectedCallId} selectedDialogPackets={selectedDialogPackets}>
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

        <div className={`${styles.diffPanel} ${compareOpen && checkedPackets.length === 2 ? styles.diffPanelOpen : ''}`} aria-modal="true" ref={diffPanelRef} role="dialog">
          <div className={styles.diffPanelHeader}>
            <span className={styles.diffPanelTitle}>
              {checkedPackets.length === 2
                ? `${checkedPackets[0].method} ${formatPacketTimestamp(checkedPackets[0].timestamp)} ↔ ${checkedPackets[1].method} ${formatPacketTimestamp(checkedPackets[1].timestamp)}`
                : 'Compare'}
            </span>
            <button aria-label="close compare" className={styles.diffCloseButton} onClick={closeCompare} type="button">×</button>
          </div>
          <div className={styles.diffPanelBody}>
            <div className={styles.diffSide}>
              <div className={styles.diffColHeader}>
                {checkedPackets[0] ? `LEFT — ${checkedPackets[0].method} ${formatPacketTimestamp(checkedPackets[0].timestamp)}` : 'LEFT'}
              </div>
              <div className={styles.diffColRows}>
                {diffLines.map((line) => (
                  <div className={`${styles.diffRow} ${diffRowClass(line.state)}`} key={`left-${line.key}`}>
                    {line.left === null ? '' : `${line.key}: ${line.left}`}
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.diffDivider} />
            <div className={styles.diffSide}>
              <div className={styles.diffColHeader}>
                {checkedPackets[1] ? `RIGHT — ${checkedPackets[1].method} ${formatPacketTimestamp(checkedPackets[1].timestamp)}` : 'RIGHT'}
              </div>
              <div className={styles.diffColRows}>
                {diffLines.map((line) => (
                  <div className={`${styles.diffRow} ${diffRowClass(line.state)}`} key={`right-${line.key}`}>
                    {line.right === null ? '' : `${line.key}: ${line.right}`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {tooltip.code !== null ? (
          <div
            className={styles.sipTooltip}
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            <span className={`${styles.codeInfo} ${getTooltipCodeClass(tooltip.code)}`}>
              {tooltip.code} {getSipCodeInfo(tooltip.code).title}
            </span>
            <span className={styles.codeInfoBody}>{getSipCodeInfo(tooltip.code).explanation}</span>
          </div>
        ) : null}
      </div>
    </PageLayout>
  );
}
