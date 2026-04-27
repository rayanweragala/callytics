import { useMemo, useState, type MouseEvent } from 'react';
import { Pagination } from '../common/Pagination';
import { SearchableSelect } from '../common/SearchableSelect';
import { TruncatedText } from '../common/TruncatedText';
import type { SipPacket } from '../../types';
import styles from './PacketStream.module.css';
import { formatPacketTimestamp } from '../../lib/time';

const PAGE_SIZE = 15;

interface DialogRow {
  callId: string;
  packets: SipPacket[];
  firstTimestamp: string;
  firstTimeValue: number;
  methodChain: string[];
  from: string;
  to: string;
  duration: string | null;
}

function extractSipUser(value: string): string {
  const trimmed = value.trim();
  const withoutAngles = trimmed.replace(/[<>]/g, '');
  const withoutParams = withoutAngles.split(';')[0]?.trim() || withoutAngles;
  const sipMatch = withoutParams.match(/(?:sips?:)([^@\s>]+)@/i);
  if (sipMatch?.[1]) {
    return sipMatch[1].trim();
  }
  const directMatch = withoutParams.match(/^([^@\s>]+)@/);
  if (directMatch?.[1]) {
    return directMatch[1].trim();
  }
  return withoutParams;
}

function packetTimeValue(packet: SipPacket): number {
  const [hms = '00:00:00', ms = '000'] = packet.timestamp.split('.');
  const [h = '0', m = '0', s = '0'] = hms.split(':');
  return (Number(h) * 3600 * 1000) + (Number(m) * 60 * 1000) + (Number(s) * 1000) + Number(ms);
}

function getPacketCode(packet: SipPacket): number {
  return packet.statusCode ?? Number.parseInt(packet.method, 10);
}

function getCodeClass(code: number): string {
  if (code >= 200 && code < 300) {
    return styles.codeSuccess;
  }
  if (code >= 400 && code < 500) {
    return styles.codeWarning;
  }
  if (code >= 500) {
    return styles.codeError;
  }
  return styles.codeNeutral;
}

function getMethodPillClass(value: string): string {
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) {
    if (numeric >= 200 && numeric < 300) return styles.pill2xx;
    if (numeric >= 400 && numeric < 500) return styles.pill4xx;
    if (numeric >= 500) return styles.pill5xx;
    return styles.pill1xx;
  }
  if (value === 'INVITE') return styles.pillInvite;
  if (value === 'BYE') return styles.pillBye;
  if (value === 'CANCEL') return styles.pillBye;
  if (value === 'REGISTER') return styles.pillRegister;
  if (value === 'OPTIONS') return styles.pillOptions;
  if (value === 'ACK') return styles.pillOptions;
  return styles.pillDefault;
}

function packetMatchesFilters(packet: SipPacket, filters: PacketStreamFilters): boolean {
  if (filters.method !== 'all') {
    if (filters.method === 'errors') {
      const code = getPacketCode(packet);
      if (!Number.isFinite(code) || code < 400) {
        return false;
      }
    } else if (packet.method !== filters.method) {
      return false;
    }
  }

  if (filters.callId.trim() && !packet.callId.toLowerCase().includes(filters.callId.trim().toLowerCase())) {
    return false;
  }

  if (filters.endpoint) {
    const fromUser = extractSipUser(packet.from).toLowerCase();
    const toUser = extractSipUser(packet.to).toLowerCase();
    const endpointFilter = filters.endpoint.toLowerCase();
    if (fromUser !== endpointFilter && toUser !== endpointFilter) {
      return false;
    }
  }

  if (filters.from && packet.timestamp < filters.from) {
    return false;
  }

  if (filters.to && packet.timestamp > filters.to) {
    return false;
  }

  return true;
}

function buildDialogRows(packets: SipPacket[], filters: PacketStreamFilters): DialogRow[] {
  const grouped = new Map<string, SipPacket[]>();
  for (const packet of packets) {
    const current = grouped.get(packet.callId) ?? [];
    current.push(packet);
    grouped.set(packet.callId, current);
  }

  return Array.from(grouped.entries())
    .map(([callId, dialogPackets]) => {
      const sorted = dialogPackets.slice().sort((a, b) => packetTimeValue(a) - packetTimeValue(b));
      const first = sorted[0];
      const last = sorted[sorted.length - 1] ?? first;
      const methodChain = sorted.map((packet) => {
        const code = getPacketCode(packet);
        return Number.isFinite(code) && packet.statusCode !== undefined ? String(code) : packet.method;
      });
      const completePacket = sorted.find((packet) => packet.method === 'BYE');
      const durationMs = completePacket ? Math.max(0, packetTimeValue(completePacket) - packetTimeValue(first)) : null;
      return {
        callId,
        packets: sorted,
        firstTimestamp: first.timestamp,
        firstTimeValue: packetTimeValue(first),
        methodChain,
        from: first.from,
        to: last.to,
        duration: durationMs === null ? null : `${Math.round(durationMs / 1000)}s`,
      };
    })
    .filter((dialog) => dialog.packets.some((packet) => packetMatchesFilters(packet, filters)))
    .sort((a, b) => b.firstTimeValue - a.firstTimeValue);
}

export interface PacketStreamFilters {
  method: string;
  callId: string;
  endpoint: string | null;
  from: string;
  to: string;
}

interface PacketStreamProps {
  packets: SipPacket[];
  selectedCallId: string | null;
  onSelectCallId: (callId: string, preferredTab?: 'headers' | 'ladder' | 'codecs') => void;
  filters: PacketStreamFilters;
  onFiltersChange: (next: PacketStreamFilters) => void;
  viewMode: 'stream' | 'dialog';
  onCodeHoverShow: (code: number, x: number, y: number) => void;
  onCodeHoverHide: () => void;
  checkedPacketIds: string[];
  onCheckedPacketIdsChange: (ids: string[]) => void;
  compareOpen: boolean;
  onCompareOpen: () => void;
}

export function PacketStream({
  packets,
  selectedCallId,
  onSelectCallId,
  filters,
  onFiltersChange,
  viewMode,
  onCodeHoverShow,
  onCodeHoverHide,
  checkedPacketIds,
  onCheckedPacketIdsChange,
  onCompareOpen,
}: PacketStreamProps) {
  const [page, setPage] = useState(1);

  const endpointOptions = useMemo(() => {
    const values = new Set<string>();
    for (const packet of packets) {
      const fromUser = extractSipUser(packet.from);
      const toUser = extractSipUser(packet.to);
      if (fromUser) {
        values.add(fromUser);
      }
      if (toUser) {
        values.add(toUser);
      }
    }
    return Array.from(values)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [packets]);

  const methodOptions = useMemo(() => ([
    { value: 'all', label: 'All' },
    { value: 'INVITE', label: 'INVITE' },
    { value: 'BYE', label: 'BYE' },
    { value: 'ACK', label: 'ACK' },
    { value: 'REGISTER', label: 'REGISTER' },
    { value: 'OPTIONS', label: 'OPTIONS' },
    { value: 'errors', label: 'Errors only' },
  ]), []);

  const filteredPackets = useMemo(() => packets.filter((packet) => packetMatchesFilters(packet, filters)), [packets, filters]);
  const dialogRows = useMemo(() => buildDialogRows(packets, filters), [packets, filters]);

  const visibleCount = viewMode === 'dialog' ? dialogRows.length : filteredPackets.length;
  const totalPages = Math.max(1, Math.ceil(visibleCount / PAGE_SIZE));
  const pagePackets = filteredPackets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageDialogs = dialogRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const checkedPackets = checkedPacketIds
    .map((id) => packets.find((packet) => packet.id === id))
    .filter((packet): packet is SipPacket => Boolean(packet));

  const setFilters = (next: Partial<PacketStreamFilters>) => {
    setPage(1);
    onFiltersChange({ ...filters, ...next });
  };

  const toggleCheckedPacket = (packetId: string) => {
    const current = checkedPacketIds;
    if (current.includes(packetId)) {
      onCheckedPacketIdsChange(current.filter((id) => id !== packetId));
    } else {
      onCheckedPacketIdsChange([...current, packetId].slice(-2));
    }
  };

  const handleCodeMouseEnter = (event: MouseEvent<HTMLSpanElement>, code: number) => {
    event.stopPropagation();
    onCodeHoverShow(code, event.clientX, event.clientY);
  };

  const handleCodeMouseLeave = (event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    onCodeHoverHide();
  };

  return (
    <section className={styles.leftPanel}>
      <div className={styles.filters}>
        <SearchableSelect
          options={methodOptions}
          onChange={(value) => setFilters({ method: value || 'all' })}
          placeholder="Method"
          value={filters.method}
        />
        <input
          aria-label="call-id filter"
          className={styles.input}
          onChange={(event) => setFilters({ callId: event.target.value })}
          placeholder="Call-ID"
          value={filters.callId}
        />
        <SearchableSelect
          options={endpointOptions}
          onChange={(value) => setFilters({ endpoint: value })}
          placeholder="Trunk/Extension"
          value={filters.endpoint}
        />
        <input
          aria-label="from time"
          className={styles.input}
          onChange={(event) => setFilters({ from: event.target.value })}
          placeholder="from HH:MM:SS.mmm"
          value={filters.from}
        />
        <input
          aria-label="to time"
          className={styles.input}
          onChange={(event) => setFilters({ to: event.target.value })}
          placeholder="to HH:MM:SS.mmm"
          value={filters.to}
        />
        {checkedPackets.length === 2 ? (
          <button className={styles.compareButton} onClick={onCompareOpen} type="button">
            Compare
          </button>
        ) : null}
      </div>

      {viewMode === 'dialog' ? (
        <>
          <div className={styles.dialogHead}>
            <span>TIME</span>
            <span>CHAIN</span>
            <span>FROM / TO</span>
            <span>CALL-ID</span>
            <span>DURATION</span>
          </div>

          <div className={styles.tableBody}>
            {pageDialogs.map((dialog) => (
              <button
                aria-label={`${dialog.firstTimestamp} ${dialog.methodChain.join(' ')} ${dialog.from} ${dialog.to} ${dialog.callId}`}
                className={`${styles.dialogRow} ${selectedCallId === dialog.callId ? styles.selectedRow : ''}`}
                key={dialog.callId}
                onClick={() => onSelectCallId(dialog.callId, 'ladder')}
                type="button"
              >
                <span className={styles.timeCell}>{formatPacketTimestamp(dialog.firstTimestamp)}</span>
                <span className={styles.methodChainWrap}>
                  {dialog.methodChain.slice(0, 6).map((value, index) => (
                    <span className={`${styles.methodPill} ${getMethodPillClass(value)}`} key={`${dialog.callId}-${value}-${index}`}>{value}</span>
                  ))}
                  {dialog.methodChain.length > 6 ? (
                    <span className={`${styles.methodPill} ${styles.pillOverflow}`}>+{dialog.methodChain.length - 6} more</span>
                  ) : null}
                </span>
                <TruncatedText className={styles.secondaryText} value={`${dialog.from} / ${dialog.to}`} />
                <TruncatedText className={styles.dataText} value={dialog.callId} />
                <span className={styles.dataText}>{dialog.duration ?? '—'}</span>
              </button>
            ))}
            {pageDialogs.length === 0 ? <div className={styles.emptyState}>No dialogs for current filter.</div> : null}
          </div>
        </>
      ) : (
        <>
          <div className={styles.tableHead}>
            <span />
            <span>TIME</span>
            <span>METHOD</span>
            <span>FROM</span>
            <span>TO</span>
            <span>CODE</span>
            <span>CALL-ID</span>
          </div>

          <div className={styles.tableBody}>
            {pagePackets.map((packet, index) => {
              const isSelected = selectedCallId === packet.callId;
              const isChecked = checkedPacketIds.includes(packet.id);
              const code = getPacketCode(packet);
              const isError = Number.isFinite(code) && code >= 400;
              const methodClass = packet.method === 'INVITE' || packet.method === 'REGISTER' || packet.method === 'OPTIONS'
                ? styles.methodSecondary
                : styles.methodDefault;
              const codeClass = Number.isFinite(code) ? getCodeClass(code) : styles.codeNeutral;
              return (
                <button
                  aria-label={`${packet.timestamp} ${packet.method} ${packet.from} ${packet.to} ${packet.callId}`}
                  className={`${styles.tableRow} timeline-entry ${isSelected ? styles.selectedRow : ''} ${isError ? styles.errorRow : ''}`}
                  key={`${packet.id}-${index}`}
                  onClick={() => onSelectCallId(packet.callId)}
                  type="button"
                >
                  <span className={styles.checkboxSlot} onClick={(event) => event.stopPropagation()}>
                    <input
                      aria-label={`select packet ${packet.timestamp} ${packet.method}`}
                      checked={isChecked}
                      className={styles.packetCheckbox}
                      onChange={() => toggleCheckedPacket(packet.id)}
                      type="checkbox"
                    />
                  </span>
                  <span className={styles.timeCell}>{formatPacketTimestamp(packet.timestamp)}</span>
                  <span className={methodClass}>{packet.method}</span>
                  <TruncatedText className={styles.secondaryText} value={packet.from} />
                  <TruncatedText className={styles.secondaryText} value={packet.to} />
                  <span className={styles.codeWrap}>
                    {packet.statusCode !== undefined ? (
                      <span
                        className={`${styles.codeBadge} ${codeClass}`}
                        onMouseEnter={(event) => handleCodeMouseEnter(event, packet.statusCode ?? code)}
                        onMouseLeave={handleCodeMouseLeave}
                      >
                        {packet.statusCode}
                      </span>
                    ) : '-'}
                  </span>
                  <TruncatedText className={styles.dataText} value={packet.callId} />
                </button>
              );
            })}
            {pagePackets.length === 0 ? <div className={styles.emptyState}>No packets for current filter.</div> : null}
          </div>
        </>
      )}

      <Pagination onPageChange={setPage} page={Math.min(page, totalPages)} totalPages={totalPages} />
    </section>
  );
}
