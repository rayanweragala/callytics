import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { SkeletonRow } from '../common/skeleton';
import type { SipTrafficItem } from '../../types';
import styles from './SipTrafficInspector.module.css';

interface SipTrafficInspectorProps {
  items: SipTrafficItem[];
  onClear: () => void;
  loading?: boolean;
}

const METHOD_OPTIONS = ['all', 'INVITE', 'REGISTER', 'OPTIONS', 'BYE'] as const;

function formatSipTimestamp(isoString: string): string {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
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

export function SipTrafficInspector({ items, onClear }: SipTrafficInspectorProps) {
  const [paused, setPaused] = useState(false);
  const [methodFilter, setMethodFilter] = useState<(typeof METHOD_OPTIONS)[number]>('all');
  const [endpointFilter, setEndpointFilter] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [displayedItems, setDisplayedItems] = useState<SipTrafficItem[]>(items);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paused) {
      return;
    }
    setDisplayedItems(items);
  }, [items, paused]);

  const filteredItems = useMemo(() => (
    displayedItems.filter((item) => {
      const methodMatches = methodFilter === 'all' || item.method.startsWith(methodFilter);
      const endpointValue = `${item.from} ${item.to}`.toLowerCase();
      const endpointMatches = !endpointFilter.trim() || endpointValue.includes(endpointFilter.trim().toLowerCase());
      return methodMatches && endpointMatches;
    })
  ), [displayedItems, endpointFilter, methodFilter]);

  useEffect(() => {
    if (!stickToBottom || !bodyRef.current) {
      return;
    }
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [filteredItems, stickToBottom]);

  const visibleItems = paused ? filteredItems.slice(0, Math.min(filteredItems.length, 200)) : filteredItems;

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Panel D</div>
          <h2 className={styles.title}>SIP Traffic Inspector</h2>
        </div>
        <div className={styles.actions}>
          <button className={styles.button} onClick={() => setPaused((current) => !current)} type="button">
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className={styles.button} onClick={() => setConfirmOpen(true)} type="button">
            Clear
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

      <div className={styles.head}>
        <span>Time</span>
        <span>Method</span>
        <span>From</span>
        <span></span>
        <span>To</span>
        <span>Dir</span>
        <span>Code</span>
      </div>

      <div
        className={styles.stream}
        onScroll={(event) => {
          const element = event.currentTarget;
          const nextStickToBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
          setStickToBottom(nextStickToBottom);
        }}
        ref={bodyRef}
      >
        {items.length === 0 ? (
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
                onClick={() => setExpandedIndex((current) => current === index ? null : index)}
                type="button"
              >
                <span>[{formatSipTimestamp(item.timestamp)}]</span>
                <span>{item.method}</span>
                <span>{item.from}</span>
                <span>→</span>
                <span>{item.to}</span>
                <span>{item.direction === 'outbound' ? '↑' : '↓'}</span>
                <span>{item.responseCode ?? '-'}</span>
              </button>
              {expandedIndex === index ? (
                <pre className={styles.raw}>{item.rawMessage}</pre>
              ) : null}
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Clear"
        message="Remove all captured SIP rows from the inspector?"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          setExpandedIndex(null);
          setDisplayedItems([]);
          onClear();
        }}
        open={confirmOpen}
        title="Clear SIP traffic"
      />
    </section>
  );
}
