import { useMemo, useState } from 'react';
import { Pagination } from '../common/Pagination';
import { SearchableSelect } from '../common/SearchableSelect';
import type { SipPacket } from '../../types';
import styles from './PacketStream.module.css';
import { formatPacketTimestamp } from '../../lib/time';


const PAGE_SIZE = 15;

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
  onSelectCallId: (callId: string) => void;
  filters: PacketStreamFilters;
  onFiltersChange: (next: PacketStreamFilters) => void;
}

export function PacketStream({ packets, selectedCallId, onSelectCallId, filters, onFiltersChange }: PacketStreamProps) {
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

  const filteredPackets = useMemo(() => packets.filter((packet) => {
    if (filters.method !== 'all') {
      if (filters.method === 'errors') {
        const code = packet.statusCode ?? Number.parseInt(packet.method, 10);
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
  }), [packets, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredPackets.length / PAGE_SIZE));
  const pagePackets = filteredPackets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const setFilters = (next: Partial<PacketStreamFilters>) => {
    setPage(1);
    onFiltersChange({ ...filters, ...next });
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
      </div>

      <div className={styles.tableHead}>
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
          const code = packet.statusCode ?? Number.parseInt(packet.method, 10);
          const isError = Number.isFinite(code) && code >= 400;
          const methodClass = packet.method === 'INVITE' || packet.method === 'REGISTER' || packet.method === 'OPTIONS'
            ? styles.methodSecondary
            : styles.methodDefault;
          const codeClass = Number.isFinite(code)
            ? (code >= 200 && code < 300 ? styles.codeSuccess : code >= 400 ? styles.codeError : styles.codeNeutral)
            : styles.codeNeutral;
          return (
            <button
              aria-label={`${packet.timestamp} ${packet.method} ${packet.from} ${packet.to} ${packet.callId}`}
              className={`${styles.tableRow} timeline-entry ${isSelected ? styles.selectedRow : ''} ${isError ? styles.errorRow : ''}`}
              key={`${packet.id}-${index}`}
              onClick={() => onSelectCallId(packet.callId)}
              type="button"
            >
              <span className={styles.timeCell}>{formatPacketTimestamp(packet.timestamp)}</span>
              <span className={methodClass}>{packet.method}</span>
              <span>{packet.from}</span>
              <span>{packet.to}</span>
              <span className={codeClass}>{packet.statusCode ?? '-'}</span>
              <span>{packet.callId.slice(0, 18)}{packet.callId.length > 18 ? '…' : ''}</span>
            </button>
          );
        })}
        {pagePackets.length === 0 ? <div className={styles.emptyState}>No packets for current filter.</div> : null}
      </div>

      <Pagination onPageChange={setPage} page={Math.min(page, totalPages)} totalPages={totalPages} />
    </section>
  );
}
