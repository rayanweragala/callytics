import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect, type SearchableSelectOption } from '../components/common/SearchableSelect';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import {
  createTrunk,
  deleteTrunk,
  getSettings,
  getTrunkTestStatus,
  listAllAudio,
  listTrunks,
  testTrunk,
  testTrunkInbound,
  testTrunkOutbound,
  updateSettings,
  updateTrunk,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import type { AudioFileItem, SipTrunkItem, SystemSettings, TrunkTestResult } from '../types';
import styles from './TrunksPage.module.css';

function SignalIcon() {
  return (
    <svg aria-hidden="true" className={styles.signalIcon} viewBox="0 0 16 16">
      <path d="M3 11.5a5 5 0 0 1 10 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 11.5a3 3 0 0 1 6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 11.5a1 1 0 0 1 2 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function OutboundIcon() {
  return (
    <svg aria-hidden="true" className={styles.signalIcon} viewBox="0 0 16 16">
      <path d="M3.5 12.5h5.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M7.8 9.1 12.5 4.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M8.9 4.4h3.6v3.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function InboundIcon() {
  return (
    <svg aria-hidden="true" className={styles.signalIcon} viewBox="0 0 16 16">
      <path d="M12.5 3.5h-5.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M8.2 6.9 3.5 11.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M7.1 11.6H3.5V8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

export const PROVIDER_PRESETS = {
  twilio: {
    label: 'Twilio',
    host: 'youraccountsid.pstn.twilio.com',
    port: 5060,
    fromDomain: 'pstn.twilio.com',
  },
  telnyx: {
    label: 'Telnyx',
    host: 'sip.telnyx.com',
    port: 5060,
    fromDomain: 'sip.telnyx.com',
  },
  vonage: {
    label: 'Vonage',
    host: 'sip.nexmo.com',
    port: 5060,
    fromDomain: 'sip.nexmo.com',
  },
  signalwire: {
    label: 'SignalWire',
    host: 'yourdomain.signalwire.com',
    port: 5060,
    fromDomain: 'signalwire.com',
  },
  generic: {
    label: 'Generic / Local',
    host: '',
    port: 5060,
    fromDomain: '',
  },
} as const;

interface TrunkFormState {
  name: string;
  providerPreset: string;
  host: string;
  port: string;
  username: string;
  password: string;
  fromDomain: string;
  fromUser: string;
  dialFormat: string;
}

type TestCallStatus = 'dialing' | 'answered' | 'completed' | 'failed';

interface OutboundTestState {
  number: string;
  country: string;
  audioFileId: string;
  testCallId: string | null;
  status: TestCallStatus | null;
  reason: string | null;
  isSubmitting: boolean;
}

interface InboundTestState {
  testCallId: string | null;
  status: TestCallStatus | null;
  reason: string | null;
  isSubmitting: boolean;
}

interface ActiveTestPanel {
  trunkId: number;
  type: 'outbound' | 'inbound';
}

const emptyForm: TrunkFormState = {
  name: '',
  providerPreset: 'generic',
  host: '',
  port: '5060',
  username: '',
  password: '',
  fromDomain: '',
  fromUser: '',
  dialFormat: '{number}',
};

const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States (+1)' },
  { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'LK', label: 'Sri Lanka (+94)' },
  { code: 'IN', label: 'India (+91)' },
  { code: 'AU', label: 'Australia (+61)' },
  { code: 'SG', label: 'Singapore (+65)' },
  { code: 'CA', label: 'Canada (+1)' },
  { code: 'DE', label: 'Germany (+49)' },
  { code: 'FR', label: 'France (+33)' },
  { code: 'AE', label: 'UAE (+971)' },
];

const COUNTRY_DIAL_PREFIX: Record<string, string> = {
  US: '+1',
  GB: '+44',
  LK: '+94',
  IN: '+91',
  AU: '+61',
  SG: '+65',
  CA: '+1',
  DE: '+49',
  FR: '+33',
  AE: '+971',
};

const emptySettings: SystemSettings = {
  default_outbound_trunk_id: null,
  record_outbound_calls: false,
};

function toForm(item: SipTrunkItem | null): TrunkFormState {
  if (!item) {
    return emptyForm;
  }

  return {
    name: item.name,
    providerPreset: item.providerPreset || 'generic',
    host: item.host,
    port: String(item.port || 5060),
    username: item.username || '',
    password: item.password || '',
    fromDomain: item.fromDomain || '',
    fromUser: item.fromUser || '',
    dialFormat: item.dialFormat || '{number}',
  };
}

export function TrunksPage() {
  const windowWidth = useWindowWidth();
  const [items, setItems] = useState<SipTrunkItem[]>([]);
  const [settings, setSettings] = useState<SystemSettings>(emptySettings);
  const [draftSettings, setDraftSettings] = useState<SystemSettings>(emptySettings);
  const [settingsTrunkOptions, setSettingsTrunkOptions] = useState<SearchableSelectOption[]>([]);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [isSettingsInitial, setIsSettingsInitial] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<TrunkFormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TrunkFormState>(emptyForm);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState<Record<number, TrunkTestResult>>({});
  const [audioOptions, setAudioOptions] = useState<SearchableSelectOption[]>([]);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [activeTestPanel, setActiveTestPanel] = useState<ActiveTestPanel | null>(null);
  const [outboundTest, setOutboundTest] = useState<OutboundTestState>({
    number: '',
    country: 'US',
    audioFileId: '',
    testCallId: null,
    status: null,
    reason: null,
    isSubmitting: false,
  });
  const [inboundTest, setInboundTest] = useState<InboundTestState>({
    testCallId: null,
    status: null,
    reason: null,
    isSubmitting: false,
  });
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const badgeTimersRef = useRef<Record<number, number>>({});
  const outboundPollRef = useRef<number | null>(null);
  const inboundPollRef = useRef<number | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testPanelRef = useRef<HTMLDivElement | null>(null);
  const editPanelRef = useRef<HTMLFormElement | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const blockingLoadError = !isLoading && !isSettingsInitial ? loadError || settingsLoadError : null;
  const initialPageLoading = (isInitialLoad || isSettingsInitial) && !blockingLoadError;
  const initialPageLoadError = blockingLoadError;
  const isDirectOutboundEnabled = draftSettings.default_outbound_trunk_id !== null
    && settingsTrunkOptions.some((option) => option.value === String(draftSettings.default_outbound_trunk_id));
  const settingsDirty = JSON.stringify(settings) !== JSON.stringify(draftSettings);
  const sortedItems = useMemo(() => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [items]);
  const presetOptions = useMemo<SearchableSelectOption[]>(() => (
    Object.entries(PROVIDER_PRESETS).map(([value, preset]) => ({ value, label: preset.label }))
  ), []);
  const countryOptions = useMemo<SearchableSelectOption[]>(
    () => COUNTRY_OPTIONS.map((item) => ({ value: item.code, label: `${item.code} — ${item.label}` })),
    [],
  );

  const load = async (nextLimit = limit, nextOffset = offset) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await listTrunks(nextLimit, nextOffset);
      setItems(response.data);
      setTotal(response.total);
    } catch (error) {
      setLoadError(getApiError(error, 'Failed to load trunks'));
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  };

  const loadSettingsPanel = async () => {
    setSettingsLoadError(null);
    try {
      const [settingsResponse, trunksResponse] = await Promise.all([
        getSettings(),
        listTrunks(1000, 0),
      ]);
      setSettings(settingsResponse.data);
      setDraftSettings(settingsResponse.data);
      setSettingsTrunkOptions(
        trunksResponse.data
          .filter((item) => item.enabled)
          .map((item) => ({ value: String(item.id), label: item.name })),
      );
    } catch (error) {
      setSettingsLoadError(getApiError(error, 'failed to load direct outbound settings'));
    } finally {
      setIsSettingsInitial(false);
    }
  };

  useEffect(() => {
    void load(limit, offset);
  }, [limit, offset]);

  useEffect(() => {
    void loadSettingsPanel();
  }, []);

  useEffect(() => () => {
    Object.values(badgeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (outboundPollRef.current) window.clearInterval(outboundPollRef.current);
    if (inboundPollRef.current) window.clearInterval(inboundPollRef.current);
  }, []);

  useEffect(() => {
    if (openMenuId === null) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-trunk-menu-root="true"]')) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [openMenuId]);

  useEffect(() => {
    if (!activeTestPanel) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (testPanelRef.current?.contains(target)) {
        return;
      }
      setActiveTestPanel(null);
      resetOutboundTest();
      resetInboundTest();
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [activeTestPanel]);

  useEffect(() => {
    void listAllAudio()
      .then((response) => {
        const options = response.data.map((file: AudioFileItem) => ({
          value: String(file.id),
          label: file.name,
        }));
        setAudioOptions(options);
      })
      .catch(() => {
        setAudioOptions([]);
      });
  }, []);

  const showError = (msg: string | null) => {
    setErrorText(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) errorTimerRef.current = setTimeout(() => setErrorText(null), 6000);
  };

  const resetMessages = () => {
    showError(null);
  };

  const hideCreate = () => {
    setCreateOpen(false);
    setCreateForm(emptyForm);
    showError(null);
  };

  const hideEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
    showError(null);
  };

  useEffect(() => {
    if (editingId === null) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (editPanelRef.current?.contains(target)) {
        return;
      }
      hideEdit();
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [editingId]);

  const openCreate = () => {
    resetMessages();
    hideEdit();
    setActiveTestPanel(null);
    setOpenMenuId(null);
    setCreateOpen((current) => {
      const next = !current;
      setCreateForm(next ? emptyForm : emptyForm);
      return next;
    });
  };

  const openEdit = (item: SipTrunkItem) => {
    resetMessages();
    setCreateOpen(false);
    setConfirmDeleteId(null);
    setActiveTestPanel(null);
    setOpenMenuId(null);
    setEditingId(item.id);
    setEditForm(toForm(item));
  };

  const applyPreset = (
    value: string | null,
    mode: 'create' | 'edit',
  ) => {
    resetMessages();
    const nextPreset = value || 'generic';
    const preset = PROVIDER_PRESETS[nextPreset as keyof typeof PROVIDER_PRESETS] || PROVIDER_PRESETS.generic;
    const update = (current: TrunkFormState): TrunkFormState => ({
      ...current,
      providerPreset: nextPreset,
      host: preset.host,
      port: String(preset.port),
      fromDomain: preset.fromDomain,
    });

    if (mode === 'create') {
      setCreateForm(update);
      return;
    }
    setEditForm(update);
  };

  const hostPlaceholder = (preset: string) => {
    if (preset === 'twilio') {
      return 'replace youraccountsid with your real Twilio account subdomain';
    }
    if (preset === 'signalwire') {
      return 'replace yourdomain with your real SignalWire space';
    }
    return 'sip.provider.com';
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusyKey('create');
    resetMessages();
    try {
      await createTrunk({
        name: createForm.name.trim(),
        providerPreset: createForm.providerPreset,
        host: createForm.host.trim(),
        port: Number(createForm.port) || 5060,
        username: createForm.username.trim() || undefined,
        password: createForm.username.trim() ? createForm.password : undefined,
        fromDomain: createForm.fromDomain.trim() || undefined,
        fromUser: createForm.fromUser.trim() || undefined,
        dialFormat: createForm.dialFormat.trim() || '{number}',
      });
      hideCreate();
      setOffset(0);
      await Promise.all([load(limit, 0), loadSettingsPanel()]);
    } catch (error) {
      showError(getApiError(error, 'failed to create trunk'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null) return;
    setBusyKey(`edit-${editingId}`);
    resetMessages();
    try {
      await updateTrunk(editingId, {
        name: editForm.name.trim(),
        providerPreset: editForm.providerPreset,
        host: editForm.host.trim(),
        port: Number(editForm.port) || 5060,
        username: editForm.username.trim() || undefined,
        password: editForm.username.trim() ? editForm.password : undefined,
        fromDomain: editForm.fromDomain.trim() || undefined,
        fromUser: editForm.fromUser.trim() || undefined,
        dialFormat: editForm.dialFormat.trim() || '{number}',
      });
      hideEdit();
      await Promise.all([load(limit, offset), loadSettingsPanel()]);
    } catch (error) {
      showError(getApiError(error, 'failed to update trunk'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyKey(`delete-${id}`);
    resetMessages();
    try {
      await deleteTrunk(id);
      setConfirmDeleteId(null);
      if (editingId === id) {
        hideEdit();
      }
      const nextOffset = total - 1 <= offset && offset > 0 ? Math.max(0, offset - limit) : offset;
      setOffset(nextOffset);
      await Promise.all([load(limit, nextOffset), loadSettingsPanel()]);
    } catch (error) {
      showError(getApiError(error, 'failed to delete trunk'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleEnabled = async (item: SipTrunkItem) => {
    setBusyKey(`toggle-${item.id}`);
    resetMessages();
    try {
      await updateTrunk(item.id, { enabled: !item.enabled });
      await Promise.all([load(limit, offset), loadSettingsPanel()]);
    } catch (error) {
      showError(getApiError(error, 'failed to update trunk status'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleSettingsDraftChange = (patch: Partial<SystemSettings>) => {
    setDraftSettings((current) => ({ ...current, ...patch }));
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsLoadError(null);
    try {
      await updateSettings({
        default_outbound_trunk_id: draftSettings.default_outbound_trunk_id,
        record_outbound_calls: draftSettings.record_outbound_calls,
      });
      await loadSettingsPanel();
    } catch (error) {
      setSettingsLoadError(getApiError(error, 'failed to save direct outbound settings'));
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleTest = async (item: SipTrunkItem) => {
    setBusyKey(`test-${item.id}`);
    resetMessages();
    try {
      const response = await testTrunk(item.id);
      if (badgeTimersRef.current[item.id]) {
        window.clearTimeout(badgeTimersRef.current[item.id]);
      }
      setTestResults((current) => ({ ...current, [item.id]: response }));
      badgeTimersRef.current[item.id] = window.setTimeout(() => {
        setTestResults((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
      }, 8000);
    } catch (error) {
      showError(getApiError(error, 'failed to test trunk'));
    } finally {
      setBusyKey(null);
    }
  };

  const renderTestBadge = (itemId: number) => {
    const result = testResults[itemId];
    if (!result) {
      return null;
    }

    const badgeClassName =
      result.status === 'reachable'
        ? styles.badgeReachable
        : result.status === 'unreachable'
          ? styles.badgeUnreachable
          : styles.badgeNotLoaded;

    return <div className={`${styles.testBadge} ${badgeClassName}`}>{result.message}</div>;
  };

  const resetOutboundTest = () => {
    if (outboundPollRef.current) {
      window.clearInterval(outboundPollRef.current);
      outboundPollRef.current = null;
    }
    setOutboundTest({
      number: '',
      country: 'US',
      audioFileId: '',
      testCallId: null,
      status: null,
      reason: null,
      isSubmitting: false,
    });
  };

  const resetInboundTest = () => {
    if (inboundPollRef.current) {
      window.clearInterval(inboundPollRef.current);
      inboundPollRef.current = null;
    }
    setInboundTest({
      testCallId: null,
      status: null,
      reason: null,
      isSubmitting: false,
    });
  };

  const toggleTestPanel = (trunkId: number, type: 'outbound' | 'inbound') => {
    setEditingId(null);
    setConfirmDeleteId(null);
    setOpenMenuId(null);
    if (activeTestPanel?.trunkId === trunkId && activeTestPanel.type === type) {
      setActiveTestPanel(null);
      if (type === 'outbound') {
        resetOutboundTest();
      } else {
        resetInboundTest();
      }
      return;
    }

    setActiveTestPanel({ trunkId, type });
    if (type === 'outbound') {
      resetInboundTest();
      resetOutboundTest();
    } else {
      resetOutboundTest();
      resetInboundTest();
    }
  };

  const closeTestPanel = () => {
    setActiveTestPanel(null);
    resetOutboundTest();
    resetInboundTest();
  };

  const pollOutboundStatus = (trunkId: number, testCallId: string) => {
    if (outboundPollRef.current) {
      window.clearInterval(outboundPollRef.current);
      outboundPollRef.current = null;
    }
    outboundPollRef.current = window.setInterval(() => {
      void getTrunkTestStatus(trunkId, testCallId)
        .then((result) => {
          setOutboundTest((current) => ({
            ...current,
            status: result.status,
            reason: result.reason,
            isSubmitting: result.status === 'dialing',
          }));
          if (result.status === 'completed' || result.status === 'failed') {
            if (outboundPollRef.current) {
              window.clearInterval(outboundPollRef.current);
              outboundPollRef.current = null;
            }
          }
        })
        .catch((error) => {
          setOutboundTest((current) => ({
            ...current,
            status: 'failed',
            reason: getApiError(error, 'failed to fetch test status'),
            isSubmitting: false,
          }));
          if (outboundPollRef.current) {
            window.clearInterval(outboundPollRef.current);
            outboundPollRef.current = null;
          }
        });
    }, 2000);
  };

  const pollInboundStatus = (trunkId: number, testCallId: string) => {
    if (inboundPollRef.current) {
      window.clearInterval(inboundPollRef.current);
      inboundPollRef.current = null;
    }
    inboundPollRef.current = window.setInterval(() => {
      void getTrunkTestStatus(trunkId, testCallId)
        .then((result) => {
          setInboundTest((current) => ({
            ...current,
            status: result.status,
            reason: result.reason,
            isSubmitting: result.status === 'dialing',
          }));
          if (result.status === 'completed' || result.status === 'failed') {
            if (inboundPollRef.current) {
              window.clearInterval(inboundPollRef.current);
              inboundPollRef.current = null;
            }
          }
        })
        .catch((error) => {
          setInboundTest((current) => ({
            ...current,
            status: 'failed',
            reason: getApiError(error, 'failed to fetch test status'),
            isSubmitting: false,
          }));
          if (inboundPollRef.current) {
            window.clearInterval(inboundPollRef.current);
            inboundPollRef.current = null;
          }
        });
    }, 2000);
  };

  const formatE164OnBlur = (rawNumber: string, country: string): string => {
    const compact = rawNumber.trim().replace(/[^\d+]/g, '');
    if (!compact) {
      return '';
    }
    if (compact.startsWith('+')) {
      return `+${compact.slice(1).replace(/\D/g, '')}`;
    }
    const dialCode = COUNTRY_DIAL_PREFIX[country] || '+1';
    return `${dialCode}${compact.replace(/\D/g, '')}`;
  };

  const handleStartOutboundTest = async () => {
    if (!activeTestPanel || activeTestPanel.type !== 'outbound') return;
    const number = outboundTest.number.trim();
    if (!number) {
      setOutboundTest((current) => ({ ...current, status: 'failed', reason: 'number is required' }));
      return;
    }

    setOutboundTest((current) => ({ ...current, isSubmitting: true, status: 'dialing', reason: null }));
    try {
      const response = await testTrunkOutbound(
        activeTestPanel.trunkId,
        number,
        outboundTest.audioFileId ? Number(outboundTest.audioFileId) : null,
      );
      setOutboundTest((current) => ({
        ...current,
        testCallId: response.testCallId,
      }));
      pollOutboundStatus(activeTestPanel.trunkId, response.testCallId);
    } catch (error) {
      setOutboundTest((current) => ({
        ...current,
        status: 'failed',
        reason: getApiError(error, 'failed to start outbound test'),
        isSubmitting: false,
      }));
    }
  };

  const handleStartInboundTest = async () => {
    if (!activeTestPanel || activeTestPanel.type !== 'inbound') return;
    setInboundTest((current) => ({ ...current, isSubmitting: true, status: 'dialing', reason: null }));
    try {
      const response = await testTrunkInbound(activeTestPanel.trunkId);
      setInboundTest((current) => ({
        ...current,
        testCallId: response.testCallId,
      }));
      pollInboundStatus(activeTestPanel.trunkId, response.testCallId);
    } catch (error) {
      setInboundTest((current) => ({
        ...current,
        status: 'failed',
        reason: getApiError(error, 'failed to start inbound test'),
        isSubmitting: false,
      }));
    }
  };

  const formatStatusLine = (status: TestCallStatus, reason: string | null): string => {
    if (status === 'dialing') return 'Dialing...';
    if (status === 'answered') return 'Answered';
    if (status === 'completed') return 'Completed';
    return reason ? `Failed: ${reason}` : 'Failed';
  };

  const pageActions = (
    <button className={styles.primaryButton} onClick={openCreate} type="button">
      {createOpen ? 'cancel' : 'add trunk'}
    </button>
  );

  if (blockingLoadError) {
    return (
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <PageLayout title="SIP trunks" subtitle="configure" />
        </div>
        <ErrorMessage message={blockingLoadError} />
      </div>
    );
  }

  if (initialPageLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <PageLayout title="SIP trunks" subtitle="configure" />
        </div>
        <Loading message="Loading trunks..." />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="SIP trunks" subtitle="configure" />
        {pageActions}
      </div>
      {createOpen ? (
        <section className={styles.formPanel}>
          <div className={styles.panelTitle}>new trunk</div>
          <form className={styles.formGrid} onSubmit={(event) => void handleCreate(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>trunk name</span>
              <input className={styles.input} required value={createForm.name} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, name: event.target.value }));
              }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>provider preset</span>
              <SearchableSelect options={presetOptions} placeholder="select provider" value={createForm.providerPreset} onChange={(value) => applyPreset(value, 'create')} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>host</span>
              <input className={`${styles.input} ${styles.dataMono}`} placeholder={hostPlaceholder(createForm.providerPreset)} required value={createForm.host} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, host: event.target.value }));
              }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>port</span>
              <input className={`${styles.input} ${styles.dataMono}`} min={1} type="number" value={createForm.port} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, port: event.target.value }));
              }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>username</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.username} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, username: event.target.value }));
              }} />
              <span className={styles.helper}>Leave blank for providers that don't require SIP registration (some local carriers).</span>
            </label>
            {createForm.username.trim() ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>password</span>
                <input className={`${styles.input} ${styles.dataMono}`} type="password" value={createForm.password} onChange={(event) => {
                  resetMessages();
                  setCreateForm((current) => ({ ...current, password: event.target.value }));
                }} />
              </label>
            ) : null}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>from domain</span>
              <input className={`${styles.input} ${styles.dataMono}`} placeholder="provider.com" value={createForm.fromDomain} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, fromDomain: event.target.value }));
              }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>from user</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.fromUser} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, fromUser: event.target.value }));
              }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>dial format</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.dialFormat} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, dialFormat: event.target.value }));
              }} />
              <span className={styles.helper}>Use {'{number}'} as placeholder. Example: +{'{number}'} for Twilio.</span>
            </label>
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} onClick={hideCreate} type="button">cancel</button>
              <button className={styles.primaryButton} type="submit">{busyKey === 'create' ? 'saving…' : 'save trunk'}</button>
            </div>
          </form>
          {errorText ? <ErrorMessage message={errorText} /> : null}
        </section>
      ) : null}

      {!initialPageLoadError ? (
      <section className={styles.settingsPanel}>
        <div className={styles.panelTitle}>direct outbound dial</div>
        <div className={styles.settingsGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>default outbound trunk</span>
            <SearchableSelect
              options={settingsTrunkOptions}
              value={draftSettings.default_outbound_trunk_id === null ? null : String(draftSettings.default_outbound_trunk_id)}
              onChange={(value) => handleSettingsDraftChange({ default_outbound_trunk_id: value ? Number(value) : null })}
              placeholder="Select trunk"
              disabled={settingsSaving}
            />
          </label>
          <div className={styles.settingsToggleField}>
            <div>
              <div className={styles.toggleLabel}>Record outbound calls</div>
              <div className={styles.toggleSubLabel}>Record call</div>
            </div>
            <button
              aria-checked={draftSettings.record_outbound_calls}
              aria-label="Record outbound calls"
              className={`${styles.toggleSwitch} ${draftSettings.record_outbound_calls ? styles.toggleOn : ''}`}
              disabled={settingsSaving}
              onClick={() => handleSettingsDraftChange({ record_outbound_calls: !draftSettings.record_outbound_calls })}
              role="switch"
              type="button"
            >
              <span />
            </button>
          </div>
        </div>
        {!isDirectOutboundEnabled ? (
          <div className={styles.settingsNote}>
            Direct outbound dial is disabled. Select a default trunk to enable it.
          </div>
        ) : null}
        {settingsDirty ? (
          <div className={styles.formActions} style={{ marginTop: '16px' }}>
            <button className={styles.secondaryButton} onClick={() => setDraftSettings(settings)} disabled={settingsSaving} type="button">cancel</button>
            <button className={styles.primaryButton} onClick={() => void handleSaveSettings()} disabled={settingsSaving} type="button">
              {settingsSaving ? 'saving…' : 'save changes'}
            </button>
          </div>
        ) : null}
        {settingsLoadError ? <ErrorMessage message={settingsLoadError} /> : null}
      </section>
      ) : null}

      <div className={styles.tableCard}>
        {initialPageLoadError ? <ErrorMessage message={initialPageLoadError} /> : null}
        {!initialPageLoadError ? (
        <>
        {isLoading ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '150px' },
                { width: '140px' },
                { width: '200px' },
                { width: '72px' },
                { width: '72px' },
                { width: '132px' },
                { width: '108px' },
                { width: '220px' },
              ]} />
            ))}
          </>
        ) : sortedItems.length === 0 ? (
          <div className={styles.emptyState}>No trunks configured. Add your first SIP trunk.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Host</th>
                <th>Port</th>
                <th>Auth</th>
                <th>Status</th>
                <th>Created</th>
                <th className={styles.actionsHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => {
                const presetLabel = PROVIDER_PRESETS[item.providerPreset as keyof typeof PROVIDER_PRESETS]?.label || item.providerPreset || 'Generic / Local';
                return (
                  <Fragment key={item.id}>
                    <tr className={styles.row}>
                      <td className={styles.rowValue}>{item.name}</td>
                      <td className={styles.rowMuted}>{presetLabel}</td>
                      <td className={styles.dataMono}>{item.host}</td>
                      <td className={styles.dataMono}>{item.port}</td>
                      <td className={styles.rowMuted}>{item.username ? 'Yes' : 'No'}</td>
                      <td>
                        <button className={`${styles.toggleButton} ${item.enabled ? styles.toggleOn : styles.toggleOff}`} onClick={() => void handleToggleEnabled(item)} type="button">
                          {busyKey === `toggle-${item.id}` ? <span className={styles.spinner} /> : <span className={styles.toggleKnob} />}
                          <span>{item.enabled ? 'Enabled' : 'Disabled'}</span>
                        </button>
                      </td>
                      <td className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.actions} data-trunk-menu-root="true">
                          <button className={`${styles.secondaryButton} ${styles.editButton}`} type="button" onClick={() => openEdit(item)}>edit</button>
                          <button
                            className={`${styles.secondaryButton} ${styles.rowDeleteButton}`}
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setEditingId(null);
                              setActiveTestPanel(null);
                              setConfirmDeleteId(item.id);
                            }}
                          >
                            delete
                          </button>
                          <div className={styles.menuWrap}>
                            <button
                              className={styles.menuButton}
                              type="button"
                              onClick={() => setOpenMenuId((current) => (current === item.id ? null : item.id))}
                            >
                              ···
                            </button>
                            {openMenuId === item.id ? (
                              <div className={styles.menuDropdown}>
                                <button className={styles.menuItem} type="button" onClick={() => { setOpenMenuId(null); toggleTestPanel(item.id, 'outbound'); }}>
                                  <OutboundIcon />
                                  <span>Test Outbound</span>
                                </button>
                                <button className={styles.menuItem} type="button" onClick={() => { setOpenMenuId(null); toggleTestPanel(item.id, 'inbound'); }}>
                                  <InboundIcon />
                                  <span>Test Inbound</span>
                                </button>
                                <button className={styles.menuItem} type="button" onClick={() => { setOpenMenuId(null); void handleTest(item); }}>
                                  <SignalIcon />
                                  <span>Quick Test</span>
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {renderTestBadge(item.id)}
                      </td>
                    </tr>
                    {activeTestPanel?.trunkId === item.id && activeTestPanel.type === 'outbound' ? (
                      <tr className={styles.expandedRow}>
                        <td className={styles.expandedCell} colSpan={8}>
                          <div className={styles.expandedPanel} ref={testPanelRef} data-trunk-test-panel="true">
                            <div className={styles.expandedPanelHeader}>
                              <div className={styles.expandedPanelTitle}>Test Outbound Call — {item.name}</div>
                              <button className={styles.panelCloseButton} onClick={closeTestPanel} type="button" aria-label="Close test panel">×</button>
                            </div>
                            <div className={styles.expandedFieldsRow}>
                              <label className={`${styles.field} ${styles.expandedFieldCountry}`}>
                                <span className={styles.fieldLabel}>country</span>
                                <SearchableSelect
                                  options={countryOptions}
                                  value={outboundTest.country}
                                  onChange={(value) => setOutboundTest((current) => ({ ...current, country: value || 'US' }))}
                                  placeholder="select country"
                                  disabled={outboundTest.isSubmitting}
                                />
                              </label>
                              <label className={`${styles.field} ${styles.expandedFieldNumber}`}>
                                <span className={styles.fieldLabel}>number</span>
                                <input
                                  className={`${styles.input} ${styles.dataMono}`}
                                  value={outboundTest.number}
                                  onChange={(event) => setOutboundTest((current) => ({ ...current, number: event.target.value }))}
                                  onBlur={() => setOutboundTest((current) => ({
                                    ...current,
                                    number: formatE164OnBlur(current.number, current.country),
                                  }))}
                                  placeholder="+94771234567"
                                  disabled={outboundTest.isSubmitting}
                                />
                              </label>
                              <label className={`${styles.field} ${styles.expandedFieldAudio}`}>
                                <span className={styles.fieldLabel}>play audio (optional)</span>
                                <SearchableSelect
                                  options={audioOptions}
                                  value={outboundTest.audioFileId || null}
                                  onChange={(value) => setOutboundTest((current) => ({ ...current, audioFileId: value || '' }))}
                                  placeholder="No audio — play beep"
                                  disabled={outboundTest.isSubmitting}
                                />
                              </label>
                              <button
                                className={styles.primaryButton}
                                type="button"
                                onClick={() => void handleStartOutboundTest()}
                                disabled={outboundTest.isSubmitting}
                              >
                                {outboundTest.isSubmitting ? 'Dialing...' : 'Start Test Call'}
                              </button>
                            </div>
                            {outboundTest.status ? (
                              <div className={`${styles.expandedStatusLine} ${outboundTest.status === 'completed' ? styles.expandedStatusSuccess : outboundTest.status === 'failed' ? styles.expandedStatusFailed : styles.expandedStatusMuted}`}>
                                {formatStatusLine(outboundTest.status, outboundTest.reason)}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {activeTestPanel?.trunkId === item.id && activeTestPanel.type === 'inbound' ? (
                      <tr className={styles.expandedRow}>
                        <td className={styles.expandedCell} colSpan={8}>
                          <div className={styles.expandedPanel} ref={testPanelRef} data-trunk-test-panel="true">
                            <div className={styles.expandedPanelHeader}>
                              <div className={styles.expandedPanelTitle}>Test Inbound Call — {item.name}</div>
                              <button className={styles.panelCloseButton} onClick={closeTestPanel} type="button" aria-label="Close test panel">×</button>
                            </div>
                            <div className={styles.expandedInboundRow}>
                              <div className={styles.expandedDescription}>Generates a synthetic inbound call through this trunk into your inbound routing.</div>
                              <button
                                className={styles.primaryButton}
                                type="button"
                                onClick={() => void handleStartInboundTest()}
                                disabled={inboundTest.isSubmitting}
                              >
                                {inboundTest.isSubmitting ? 'Dialing...' : 'Start Test'}
                              </button>
                            </div>
                            {inboundTest.status ? (
                              <div className={`${styles.expandedStatusLine} ${inboundTest.status === 'completed' ? styles.expandedStatusSuccess : inboundTest.status === 'failed' ? styles.expandedStatusFailed : styles.expandedStatusMuted}`}>
                                {formatStatusLine(inboundTest.status, inboundTest.reason)}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {editingId === item.id ? (
                      <tr className={styles.expandedRow}>
                        <td className={styles.expandedCell} colSpan={8}>
                          <form className={styles.editorRow} onSubmit={(event) => void handleUpdate(event)} ref={editPanelRef}>
                            <div className={styles.editPanelHeader}>
                              <span className={styles.panelTitle}>edit trunk</span>
                              <button className={styles.panelCloseButton} onClick={hideEdit} type="button" aria-label="Close edit panel">×</button>
                            </div>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>trunk name</span>
                              <input className={styles.input} required value={editForm.name} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, name: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>provider preset</span>
                              <SearchableSelect options={presetOptions} placeholder="select provider" value={editForm.providerPreset} onChange={(value) => applyPreset(value, 'edit')} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>host</span>
                              <input className={`${styles.input} ${styles.dataMono}`} placeholder={hostPlaceholder(editForm.providerPreset)} required value={editForm.host} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, host: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>port</span>
                              <input className={`${styles.input} ${styles.dataMono}`} min={1} type="number" value={editForm.port} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, port: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>username</span>
                              <input className={`${styles.input} ${styles.dataMono}`} value={editForm.username} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, username: event.target.value }));
                              }} />
                              <span className={styles.helper}>Leave blank for providers that don't require SIP registration (some local carriers).</span>
                            </label>
                            {editForm.username.trim() ? (
                              <label className={styles.field}>
                                <span className={styles.fieldLabel}>password</span>
                                <input className={`${styles.input} ${styles.dataMono}`} type="password" value={editForm.password} onChange={(event) => {
                                  resetMessages();
                                  setEditForm((current) => ({ ...current, password: event.target.value }));
                                }} />
                              </label>
                            ) : null}
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>from domain</span>
                              <input className={`${styles.input} ${styles.dataMono}`} placeholder="provider.com" value={editForm.fromDomain} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, fromDomain: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>from user</span>
                              <input className={`${styles.input} ${styles.dataMono}`} value={editForm.fromUser} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, fromUser: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>dial format</span>
                              <input className={`${styles.input} ${styles.dataMono}`} value={editForm.dialFormat} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, dialFormat: event.target.value }));
                              }} />
                              <span className={styles.helper}>Use {'{number}'} as placeholder. Example: +{'{number}'} for Twilio, 0{'{number}'} for Dialog.</span>
                            </label>
                            <div className={styles.formActions}>
                              <button className={styles.secondaryButton} onClick={hideEdit} type="button">cancel</button>
                              <button className={styles.primaryButton} type="submit">{busyKey === `edit-${item.id}` ? 'saving…' : 'save changes'}</button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        </>
        ) : null}
        <Pagination page={page} totalPages={totalPages} onPageChange={(nextPage) => setOffset((nextPage - 1) * limit)} />
        {errorText ? <ErrorMessage message={errorText} /> : null}
      </div>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete trunk"
        message="Delete this trunk?"
        cancelLabel="cancel"
        confirmLabel={confirmDeleteId !== null && busyKey === `delete-${confirmDeleteId}` ? 'deleting…' : 'delete'}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId !== null) {
            void handleDelete(confirmDeleteId);
          }
        }}
      />
    </div>
  );
}
