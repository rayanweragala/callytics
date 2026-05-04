import { useEffect, useMemo, useRef, useState } from 'react';
import { getDiagnosticsSipMessages } from '../../lib/api';
import type { SipMessage, SipTrafficItem } from '../../types';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { Pagination } from '../common/Pagination';
import { SkeletonRow } from '../common/skeleton';
import styles from './SipTrafficInspector.module.css';

interface SipTrafficInspectorProps {
  items: SipTrafficItem[];
  onClear: () => void;
  loading?: boolean;
  onRowClick?: (callId: string) => void;
}

const METHOD_OPTIONS = ['all', 'INVITE', 'REGISTER', 'OPTIONS', 'BYE'] as const;
const SIP_PAGE_SIZE = 5;

function formatSipTimestamp(isoString: string): string {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function toTrafficItem(message: SipMessage): SipTrafficItem {
  return {
    callId: message.callId,
    timestamp: message.timestamp,
    method: message.method || '-',
    from: message.fromUri || 'unknown',
    to: message.toUri || 'unknown',
    direction: message.direction === 'outbound' ? 'outbound' : 'inbound',
    responseCode: message.responseCode,
    rawMessage: message.rawMessage || '',
  };
}

function getRowTone(item: SipTrafficItem): string {
  if (item.responseCode !== null && item.responseCode >= 400) {
    return styles.error;
  }
  if (item.responseCode !== null && item.responseCode >= 200 && item.responseCode < 300) {
    return styles.success;
  }
  if (item.method === 'BYE' || item.method === 'CANCEL') {
    return styles.warning;
  }
  return styles.info;
}

function codeClass(code: number | null): string {
  if (code !== null && code >= 200 && code < 300) {
    return styles.codeSuccess;
  }
  if (code !== null && code >= 400) {
    return styles.codeError;
  }
  return styles.codeNeutral;
}

function methodClass(method: string): string {
  return method === 'INVITE' || method === 'REGISTER' || method === 'OPTIONS'
    ? styles.methodSecondary
    : styles.methodDefault;
}

function uniqueItems(items: SipTrafficItem[]): SipTrafficItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.timestamp}|${item.method}|${item.from}|${item.to}|${item.direction}|${item.responseCode ?? '-'}|${item.callId ?? ''}|${item.rawMessage}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function SipTrafficInspector({ items, onClear, loading = false, onRowClick }: SipTrafficInspectorProps) {
  const [paused, setPaused] = useState(false);
  const [methodFilter, setMethodFilter] = useState<(typeof METHOD_OPTIONS)[number]>('all');
  const [endpointFilter, setEndpointFilter] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<SipTrafficItem[]>([]);
  const [liveItems, setLiveItems] = useState<SipTrafficItem[]>([]);
  const [viewCleared, setViewCleared] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const liveCursorRef = useRef(items.length);

  useEffect(() => {
    let active = true;
    const loadPage = async () => {
      setHistoryLoading(true);
      try {
        const response = await getDiagnosticsSipMessages(historyPage, SIP_PAGE_SIZE);
        if (!active) {
          return;
        }
        setHistoryItems(response.data.map(toTrafficItem));
        setHistoryTotal(response.total);
      } catch {
        if (!active) {
          return;
        }
        setHistoryItems([]);
        setHistoryTotal(0);
      } finally {
        if (active) {
          setHistoryLoading(false);
        }
      }
    };

    void loadPage();
    return () => {
      active = false;
    };
  }, [historyPage]);

  useEffect(() => {
    if (items.length < liveCursorRef.current) {
      liveCursorRef.current = items.length;
    }

    if (paused) {
      return;
    }

    const nextItems = items.slice(liveCursorRef.current);
    liveCursorRef.current = items.length;

    if (nextItems.length === 0) {
      return;
    }

    setLiveItems((current) => [...current, ...nextItems].slice(-100));
  }, [items, paused]);

  const totalPages = Math.max(1, Math.ceil(historyTotal / SIP_PAGE_SIZE));

  const pageItems = useMemo(() => {
    if (viewCleared) {
      return [];
    }
    if (historyPage === 1) {
      return uniqueItems([...liveItems.slice().reverse(), ...historyItems]);
    }
    return historyItems;
  }, [historyItems, historyPage, liveItems, viewCleared]);

  const filteredItems = useMemo(() => (
    pageItems.filter((item) => {
      const methodMatches = methodFilter === 'all' || item.method.startsWith(methodFilter);
      const endpointValue = `${item.from} ${item.to}`.toLowerCase();
      const endpointMatches = !endpointFilter.trim() || endpointValue.includes(endpointFilter.trim().toLowerCase());
      return methodMatches && endpointMatches;
    })
  ), [endpointFilter, methodFilter, pageItems]);

  const visibleItems = paused ? filteredItems.slice(0, Math.min(filteredItems.length, 200)) : filteredItems;

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>SIP Traffic Inspector</h2>
        </div>
        <div className={styles.actions}>
          <button className={styles.button} onClick={() => setPaused((current) => !current)} type="button">
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className={styles.button} onClick={() => setConfirmOpen(true)} type="button">
            Clear View
          </button>
        </div>
      </div>

      <div className={styles.filters}>
        <select aria-label="method filter" className={styles.select} value={methodFilter} onChange={(event) => setMethodFilter(event.target.value as (typeof METHOD_OPTIONS)[number])}>
          {METHOD_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        <input
          aria-label="endpoint filter"
          className={styles.input}
          onChange={(event) => setEndpointFilter(event.target.value)}
          placeholder="filter by endpoint"
          value={endpointFilter}
        />
      </div>

      {note ? <div className={styles.note}>{note}</div> : null}

      <div className={styles.head}>
        <span>Time</span>
        <span>Method</span>
        <span>From</span>
        <span></span>
        <span>To</span>
        <span>Dir</span>
        <span>Code</span>
      </div>

      <div className={styles.stream}>
        {((loading || historyLoading) && visibleItems.length === 0) ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '120px' },
                { width: '130px' },
                { width: '1fr' },
                { width: '24px' },
                { width: '1fr' },
                { width: '30px' },
                { width: '70px' },
              ]} />
            ))}
          </>
        ) : (
          visibleItems.map((item, index) => (
            <div key={`${item.timestamp}-${index}`}>
              <button
                className={`${styles.row} ${getRowTone(item)}`}
                onClick={() => {
                  setExpandedIndex((current) => current === index ? null : index);
                  if (!item.callId) {
                    setNote('No Call-ID available for this message');
                    return;
                  }
                  setNote(null);
                  onRowClick?.(item.callId);
                }}
                type="button"
              >
                <span>[{formatSipTimestamp(item.timestamp)}]</span>
                <span className={methodClass(item.method)}>{item.method}</span>
                <span>{item.from}</span>
                <span>→</span>
                <span>{item.to}</span>
                <span>{item.direction === 'outbound' ? '↑' : '↓'}</span>
                <span className={codeClass(item.responseCode)}>{item.responseCode ?? '-'}</span>
              </button>
              {expandedIndex === index ? (
                <pre className={styles.raw}>{item.rawMessage}</pre>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className={styles.pagination}>
        <Pagination onPageChange={(page) => {
          setExpandedIndex(null);
          setViewCleared(false);
          setHistoryPage(page);
        }} page={historyPage} totalPages={totalPages} />
      </div>

      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Clear"
        message="Clear only the local SIP traffic view? Stored history remains in the database."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setExpandedIndex(null);
          setNote(null);
          setViewCleared(true);
          setLiveItems([]);
          liveCursorRef.current = items.length;
          onClear();
        }}
        open={confirmOpen}
        title="Clear SIP traffic view"
      />
    </section>
  );
}
