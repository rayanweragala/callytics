import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { listAllAudio, listExtensions, listFlows, listInboundRoutes, listTrunks } from '../lib/api';
import type { AudioFileItem, ExtensionItem, FlowSummary, InboundRouteItem, SipTrunkItem } from '../types';
import styles from './CommandPalette.module.css';

type CommandPaletteCategory = 'Flow' | 'Extension' | 'Trunk' | 'Route' | 'Audio' | 'Page';
type CommandPaletteIconKey = 'flow' | 'extension' | 'trunk' | 'route' | 'audio' | 'page';

interface CommandPaletteItem {
  id: string;
  label: string;
  route: string;
  category: CommandPaletteCategory;
  iconKey: CommandPaletteIconKey;
  keywords: string[];
  keyboardHint?: string;
  end?: boolean;
}

export interface SidebarNavigationItem {
  label: string;
  route: string;
  category: 'Page';
  iconKey: 'page';
  keywords: string[];
  end?: boolean;
}

interface SidebarNavigationGroup {
  label: string;
  items: SidebarNavigationItem[];
}

interface MatchedCommandPaletteItem extends CommandPaletteItem {
  matchPositions: number[];
  matchRank: number;
}

interface CommandPaletteContextValue {
  isOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  recordVisit: (item: Pick<CommandPaletteItem, 'label' | 'route' | 'category' | 'iconKey' | 'keyboardHint'>) => void;
  recentItems: Array<Pick<CommandPaletteItem, 'label' | 'route' | 'category' | 'iconKey' | 'keyboardHint'>>;
  shortcutLabel: string;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

const MAX_RESULTS = 8;
const MAX_RECENT_ITEMS = 5;
const SEARCH_LIMIT = 1000;

export const sidebarNavigationGroups: SidebarNavigationGroup[] = [
  {
    label: 'MONITOR',
    items: [
      { label: 'diagnostics', route: '/', category: 'Page', iconKey: 'page', keywords: ['monitor', 'dashboard', 'health'], end: true },
      { label: 'logs', route: '/logs', category: 'Page', iconKey: 'page', keywords: ['asterisk logs', 'system logs'] },
      { label: 'call logs', route: '/call-logs', category: 'Page', iconKey: 'page', keywords: ['calls', 'history'] },
      { label: 'webhook logs', route: '/webhook-logs', category: 'Page', iconKey: 'page', keywords: ['webhooks', 'deliveries'] },
      { label: 'capture', route: '/capture', category: 'Page', iconKey: 'page', keywords: ['sip capture', 'packets'] },
      { label: 'recordings', route: '/recordings', category: 'Page', iconKey: 'page', keywords: ['audio recordings'] },
    ],
  },
  {
    label: 'CONFIGURE',
    items: [
      { label: 'flow builder', route: '/flows', category: 'Page', iconKey: 'page', keywords: ['flows', 'ivr', 'builder'] },
      { label: 'extensions', route: '/extensions', category: 'Page', iconKey: 'page', keywords: ['sip users', 'phones'] },
      { label: 'contacts', route: '/contacts', category: 'Page', iconKey: 'page', keywords: ['numbers', 'contact numbers'] },
      { label: 'operators', route: '/operators', category: 'Page', iconKey: 'page', keywords: ['agents'] },
      { label: 'queues', route: '/queues', category: 'Page', iconKey: 'page', keywords: ['queue'] },
      { label: 'callbacks', route: '/callbacks', category: 'Page', iconKey: 'page', keywords: ['callback queue'] },
      { label: 'trunks', route: '/trunks', category: 'Page', iconKey: 'page', keywords: ['sip trunks', 'providers'] },
      { label: 'inbound', route: '/inbound', category: 'Page', iconKey: 'page', keywords: ['inbound routes', 'did routes'] },
      { label: 'templates', route: '/templates', category: 'Page', iconKey: 'page', keywords: ['flow templates'] },
      { label: 'audio', route: '/audio', category: 'Page', iconKey: 'page', keywords: ['prompts', 'tts', 'sound files'] },
    ],
  },
  {
    label: 'OUTBOUND',
    items: [
      { label: 'campaigns', route: '/campaigns', category: 'Page', iconKey: 'page', keywords: ['outbound campaigns'] },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { label: 'firewall', route: '/firewall', category: 'Page', iconKey: 'page', keywords: ['security', 'blocked ips'] },
      { label: 'vpn', route: '/vpn', category: 'Page', iconKey: 'page', keywords: ['wireguard'] },
      { label: 'backup & restore', route: '/backup', category: 'Page', iconKey: 'page', keywords: ['backup', 'restore'] },
      { label: 'settings', route: '/settings', category: 'Page', iconKey: 'page', keywords: ['system settings'] },
      { label: 'preflight', route: '/preflight', category: 'Page', iconKey: 'page', keywords: ['checks', 'validation'] },
    ],
  },
];

const staticPageItems: CommandPaletteItem[] = sidebarNavigationGroups.flatMap((group) =>
  group.items.map((item) => ({
    id: `page-${item.route}`,
    ...item,
    keywords: [...item.keywords, group.label.toLowerCase(), item.route],
  })),
);

function isMacLikePlatform() {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform = navigator.platform || navigator.userAgent || '';
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"]'));
}

function buildFlowItems(items: FlowSummary[]): CommandPaletteItem[] {
  return items
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      id: `flow-${item.id}`,
      label: item.name,
      route: '/flows',
      category: 'Flow',
      iconKey: 'flow',
      keywords: [item.description ?? '', 'flow builder', 'flows'],
    }));
}

function buildExtensionItems(items: ExtensionItem[]): CommandPaletteItem[] {
  return items
    .slice()
    .sort((left, right) => left.username.localeCompare(right.username))
    .map((item) => ({
      id: `extension-${item.id}`,
      label: item.displayName ? `${item.username} ${item.displayName}` : item.username,
      route: '/extensions',
      category: 'Extension',
      iconKey: 'extension',
      keywords: [item.username, item.displayName ?? '', item.transportType],
    }));
}

function buildTrunkItems(items: SipTrunkItem[]): CommandPaletteItem[] {
  return items
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      id: `trunk-${item.id}`,
      label: item.name,
      route: '/trunks',
      category: 'Trunk',
      iconKey: 'trunk',
      keywords: [item.host, item.providerPreset, item.fromDomain ?? ''],
    }));
}

function buildRouteItems(items: InboundRouteItem[]): CommandPaletteItem[] {
  return items
    .slice()
    .sort((left, right) => left.did.localeCompare(right.did))
    .map((item) => ({
      id: `route-${item.id}`,
      label: item.label ? `${item.did} ${item.label}` : item.did,
      route: '/inbound',
      category: 'Route',
      iconKey: 'route',
      keywords: [item.did, item.label ?? '', item.flowName ?? '', 'inbound route'],
    }));
}

function buildAudioItems(items: AudioFileItem[]): CommandPaletteItem[] {
  return items
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item) => ({
      id: `audio-${item.id}`,
      label: item.name,
      route: '/audio',
      category: 'Audio',
      iconKey: 'audio',
      keywords: [item.originalFilename ?? '', item.sourceType, item.ttsVoice ?? ''],
    }));
}

function buildRecentKey(item: Pick<CommandPaletteItem, 'label' | 'route' | 'category'>) {
  return `${item.category}:${item.route}:${item.label}`;
}

function getCategoryOrder(category: CommandPaletteCategory) {
  switch (category) {
    case 'Flow':
      return 0;
    case 'Extension':
      return 1;
    case 'Trunk':
      return 2;
    case 'Route':
      return 3;
    case 'Audio':
      return 4;
    case 'Page':
      return 5;
  }
}

function getMatchForText(text: string, query: string): { positions: number[]; rank: number } | null {
  const normalizedText = text.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedText || !normalizedQuery) {
    return null;
  }

  if (normalizedText === normalizedQuery) {
    return {
      positions: Array.from({ length: text.length }, (_, index) => index),
      rank: 0,
    };
  }

  if (normalizedText.startsWith(normalizedQuery)) {
    return {
      positions: Array.from({ length: normalizedQuery.length }, (_, index) => index),
      rank: 1,
    };
  }

  const containsIndex = normalizedText.indexOf(normalizedQuery);
  if (containsIndex >= 0) {
    return {
      positions: Array.from({ length: normalizedQuery.length }, (_, offset) => containsIndex + offset),
      rank: 2,
    };
  }

  const positions: number[] = [];
  let queryIndex = 0;
  for (let index = 0; index < normalizedText.length && queryIndex < normalizedQuery.length; index += 1) {
    if (normalizedText[index] === normalizedQuery[queryIndex]) {
      positions.push(index);
      queryIndex += 1;
    }
  }

  if (queryIndex !== normalizedQuery.length) {
    return null;
  }

  return {
    positions,
    rank: 3,
  };
}

function getItemMatch(item: CommandPaletteItem, query: string): MatchedCommandPaletteItem | null {
  const labelMatch = getMatchForText(item.label, query);
  if (labelMatch) {
    return {
      ...item,
      matchPositions: labelMatch.positions,
      matchRank: labelMatch.rank,
    };
  }

  const keywordMatch = item.keywords
    .map((keyword) => getMatchForText(keyword, query))
    .filter((match): match is { positions: number[]; rank: number } => match !== null)
    .sort((left, right) => left.rank - right.rank)[0];

  if (!keywordMatch) {
    return null;
  }

  return {
    ...item,
    matchPositions: [],
    matchRank: keywordMatch.rank,
  };
}

function renderHighlightedLabel(label: string, positions: number[]) {
  if (positions.length === 0) {
    return label;
  }

  const highlightedPositions = new Set(positions);
  const fragments: ReactNode[] = [];
  let index = 0;

  while (index < label.length) {
    if (!highlightedPositions.has(index)) {
      let plainEnd = index + 1;
      while (plainEnd < label.length && !highlightedPositions.has(plainEnd)) {
        plainEnd += 1;
      }
      fragments.push(label.slice(index, plainEnd));
      index = plainEnd;
      continue;
    }

    let highlightEnd = index + 1;
    while (highlightEnd < label.length && highlightedPositions.has(highlightEnd)) {
      highlightEnd += 1;
    }
    fragments.push(
      <mark className={styles.matchMark} key={`${label}-${index}`}>
        {label.slice(index, highlightEnd)}
      </mark>,
    );
    index = highlightEnd;
  }

  return fragments;
}

function CategoryIcon({ iconKey }: { iconKey: CommandPaletteIconKey }) {
  switch (iconKey) {
    case 'flow':
      return (
        <svg aria-hidden="true" className={styles.iconSvg} viewBox="0 0 16 16">
          <circle cx="3" cy="4" r="1.5" fill="currentColor" />
          <circle cx="13" cy="4" r="1.5" fill="currentColor" />
          <circle cx="8" cy="12" r="1.5" fill="currentColor" />
          <path d="M4.5 4h7M8 5.5v5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
        </svg>
      );
    case 'extension':
      return (
        <svg aria-hidden="true" className={styles.iconSvg} viewBox="0 0 16 16">
          <path d="M5.2 2.8h5.6a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6.5 5.5h3M6.5 8h3M7.2 10.6h1.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
        </svg>
      );
    case 'trunk':
      return (
        <svg aria-hidden="true" className={styles.iconSvg} viewBox="0 0 16 16">
          <path d="M3 6.2h10M3 9.8h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
          <rect x="2.2" y="3" width="11.6" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'route':
      return (
        <svg aria-hidden="true" className={styles.iconSvg} viewBox="0 0 16 16">
          <path d="M4 4h5.5a2.5 2.5 0 1 1 0 5H5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
          <path d="M6.5 11 4 8.5 6.5 6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
        </svg>
      );
    case 'audio':
      return (
        <svg aria-hidden="true" className={styles.iconSvg} viewBox="0 0 16 16">
          <path d="M3.2 9.8h2.4L9 12.4V3.6L5.6 6.2H3.2Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
          <path d="M11 6.1a2.8 2.8 0 0 1 0 3.8M12.6 4.6a4.8 4.8 0 0 1 0 6.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
        </svg>
      );
    case 'page':
      return (
        <svg aria-hidden="true" className={styles.iconSvg} viewBox="0 0 16 16">
          <path d="M4 2.8h6l2 2v8.4H4Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.2" />
          <path d="M10 2.8v2h2M6 7h4M6 9.5h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
        </svg>
      );
  }
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [recentItems, setRecentItems] = useState<CommandPaletteContextValue['recentItems']>([]);
  const shortcutLabel = isMacLikePlatform() ? '⌘K' : 'Ctrl+K';

  const openPalette = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setIsOpen(false);
  }, []);

  const recordVisit = useCallback<CommandPaletteContextValue['recordVisit']>((item) => {
    setRecentItems((current) => {
      const next = [item, ...current.filter((entry) => buildRecentKey(entry) !== buildRecentKey(item))];
      return next.slice(0, MAX_RECENT_ITEMS);
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') {
        return;
      }
      if (event.altKey || event.shiftKey) {
        return;
      }

      const usingShortcut = event.metaKey || event.ctrlKey;
      if (!usingShortcut) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setIsOpen(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <CommandPaletteContext.Provider
      value={{
        isOpen,
        openPalette,
        closePalette,
        recordVisit,
        recentItems,
        shortcutLabel,
      }}
    >
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const context = useContext(CommandPaletteContext);
  if (!context) {
    throw new Error('useCommandPalette must be used within a CommandPaletteProvider');
  }
  return context;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { isOpen, closePalette, recordVisit, recentItems } = useCommandPalette();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loadedItems, setLoadedItems] = useState<CommandPaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fetchVersionRef = useRef(0);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setIsMounted(true);
      setIsClosing(false);
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    if (!isMounted) {
      return;
    }

    const closeDelay = prefersReducedMotion() ? 0 : 100;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsMounted(false);
      setIsClosing(false);
      closeTimerRef.current = null;
    }, closeDelay);

    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isMounted, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen, isMounted]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const requestVersion = fetchVersionRef.current + 1;
    fetchVersionRef.current = requestVersion;
    setLoading(true);

    void Promise.allSettled([
      listFlows(1, SEARCH_LIMIT),
      listExtensions(SEARCH_LIMIT, 0),
      listTrunks(SEARCH_LIMIT, 0),
      listInboundRoutes(undefined, SEARCH_LIMIT, 0),
      listAllAudio(),
    ]).then((responses) => {
      if (fetchVersionRef.current !== requestVersion) {
        return;
      }

      const [flowsResponse, extensionsResponse, trunksResponse, routesResponse, audioResponse] = responses;
      const nextItems: CommandPaletteItem[] = [...staticPageItems];

      if (flowsResponse.status === 'fulfilled') {
        nextItems.push(...buildFlowItems(flowsResponse.value.data));
      }
      if (extensionsResponse.status === 'fulfilled') {
        nextItems.push(...buildExtensionItems(extensionsResponse.value.data));
      }
      if (trunksResponse.status === 'fulfilled') {
        nextItems.push(...buildTrunkItems(trunksResponse.value.data));
      }
      if (routesResponse.status === 'fulfilled') {
        nextItems.push(...buildRouteItems(routesResponse.value.data));
      }
      if (audioResponse.status === 'fulfilled') {
        nextItems.push(...buildAudioItems(audioResponse.value.data));
      }

      setLoadedItems(nextItems);
      setLoading(false);
    });
  }, [isOpen]);

  const normalizedQuery = query.trim();

  const visibleItems = useMemo(() => {
    if (!normalizedQuery) {
      return recentItems.map((item) => ({
        id: buildRecentKey(item),
        label: item.label,
        route: item.route,
        category: item.category,
        iconKey: item.iconKey,
        keywords: [],
        keyboardHint: item.keyboardHint,
        matchPositions: [],
        matchRank: 0,
      }));
    }

    return loadedItems
      .map((item) => getItemMatch(item, normalizedQuery))
      .filter((item): item is MatchedCommandPaletteItem => item !== null)
      .sort((left, right) => {
        if (left.matchRank !== right.matchRank) {
          return left.matchRank - right.matchRank;
        }
        if (left.label.length !== right.label.length) {
          return left.label.length - right.label.length;
        }
        if (left.category !== right.category) {
          return getCategoryOrder(left.category) - getCategoryOrder(right.category);
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, MAX_RESULTS);
  }, [loadedItems, normalizedQuery, recentItems]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => (current >= visibleItems.length ? 0 : current));
  }, [visibleItems]);

  useEffect(() => {
    if (!visibleItems[selectedIndex]) {
      return;
    }
    resultRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, visibleItems]);

  const handleClose = useCallback(() => {
    closePalette();
  }, [closePalette]);

  const handleSelect = useCallback(
    (item: MatchedCommandPaletteItem) => {
      recordVisit(item);
      navigate(item.route);
      closePalette();
    },
    [closePalette, navigate, recordVisit],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
      return;
    }

    if (visibleItems.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1) % visibleItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => (current - 1 + visibleItems.length) % visibleItems.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = visibleItems[selectedIndex];
      if (item) {
        handleSelect(item);
      }
    }
  };

  if (!isMounted) {
    return null;
  }

  const showRecentState = normalizedQuery.length === 0;
  const showNoResults = !loading && normalizedQuery.length > 0 && visibleItems.length === 0;
  const showLoadingState = loading && normalizedQuery.length > 0 && visibleItems.length === 0;

  return createPortal(
    <div
      className={`${styles.overlay} ${isClosing ? styles.overlayClosing : styles.overlayOpen}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-label="Command palette"
        aria-modal="true"
        className={`${styles.panel} ${isClosing ? styles.panelClosing : styles.panelOpen}`}
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className={styles.searchArea}>
          <input
            aria-label="Search commands"
            autoComplete="off"
            className={styles.searchInput}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, flows, extensions, trunks, routes, audio…"
            ref={inputRef}
            value={query}
          />
        </div>
        <div className={styles.results}>
          {showRecentState ? <div className={styles.sectionLabel}>Recent</div> : null}
          {showRecentState && visibleItems.length === 0 ? (
            <div className={styles.emptyState}>No recent items yet.</div>
          ) : null}
          {showLoadingState ? <div className={styles.emptyState}>Searching…</div> : null}
          {showNoResults ? (
            <div className={styles.emptyState}>
              No results for <span className={styles.emptyStateQuery}>&apos;{normalizedQuery}&apos;</span>
            </div>
          ) : null}
          {!showNoResults && !showLoadingState && visibleItems.length > 0
            ? visibleItems.map((item, index) => (
                <button
                  aria-selected={index === selectedIndex}
                  className={`${styles.resultRow} ${index === selectedIndex ? styles.resultRowSelected : ''}`}
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  ref={(node) => {
                    resultRefs.current[index] = node;
                  }}
                  role="option"
                  type="button"
                >
                  <span className={styles.resultIcon} aria-hidden="true">
                    <CategoryIcon iconKey={item.iconKey} />
                  </span>
                  <span className={styles.resultContent}>
                    <span className={styles.resultLabel}>{renderHighlightedLabel(item.label, item.matchPositions)}</span>
                  </span>
                  <span className={styles.resultMeta}>
                    <span className={`${styles.categoryBadge} ${styles[`category${item.category}`]}`}>{item.category}</span>
                    {item.keyboardHint ? <span className={styles.resultHint}>{item.keyboardHint}</span> : null}
                  </span>
                </button>
              ))
            : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
