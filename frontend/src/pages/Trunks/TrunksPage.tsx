import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect, type SearchableSelectOption } from '../../components/common/SearchableSelect';
import { Pagination } from '../../components/common/Pagination';
import { createTrunk, deleteTrunk, listTrunks, testTrunk, updateTrunk } from '../../lib/api';
import { formatDateTime } from '../../lib/time';
import type { SipTrunkItem, TrunkTestResult } from '../../types';
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
  };
}

export function TrunksPage() {
  const [items, setItems] = useState<SipTrunkItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<TrunkFormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TrunkFormState>(emptyForm);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TrunkTestResult>>({});
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const badgeTimersRef = useRef<Record<number, number>>({});

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const sortedItems = useMemo(() => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [items]);
  const presetOptions = useMemo<SearchableSelectOption[]>(() => (
    Object.entries(PROVIDER_PRESETS).map(([value, preset]) => ({ value, label: preset.label }))
  ), []);

  const load = async (nextLimit = limit, nextOffset = offset) => {
    const response = await listTrunks(nextLimit, nextOffset);
    setItems(response.data);
    setTotal(response.total);
  };

  useEffect(() => {
    void load(limit, offset);
  }, [limit, offset]);

  useEffect(() => () => {
    Object.values(badgeTimersRef.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  const resetMessages = () => {
    setErrorText(null);
  };

  const hideCreate = () => {
    setCreateOpen(false);
    setCreateForm(emptyForm);
    setErrorText(null);
  };

  const hideEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
    setErrorText(null);
  };

  const openCreate = () => {
    resetMessages();
    hideEdit();
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
    setEditingId(item.id);
    setEditForm(toForm(item));
  };

  const applyPreset = (
    value: string | null,
    mode: 'create' | 'edit',
  ) => {
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
      });
      hideCreate();
      setOffset(0);
      await load(limit, 0);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to create trunk');
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
      });
      hideEdit();
      await load(limit, offset);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to update trunk');
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
      await load(limit, nextOffset);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to delete trunk');
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleEnabled = async (item: SipTrunkItem) => {
    setBusyKey(`toggle-${item.id}`);
    resetMessages();
    try {
      await updateTrunk(item.id, { enabled: !item.enabled });
      await load(limit, offset);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to update trunk status');
    } finally {
      setBusyKey(null);
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
      setErrorText(error instanceof Error ? error.message : 'failed to test trunk');
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.sectionLabel}>configure</div>
          <h1 className={styles.title}>SIP Trunks</h1>
        </div>
        <button className={styles.primaryButton} onClick={openCreate} type="button">
          {createOpen ? 'cancel' : '+ add trunk'}
        </button>
      </div>

      {createOpen ? (
        <section className={styles.formPanel}>
          <div className={styles.panelTitle}>new trunk</div>
          <form className={styles.formGrid} onSubmit={(event) => void handleCreate(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>trunk name</span>
              <input className={styles.input} required value={createForm.name} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>provider preset</span>
              <SearchableSelect options={presetOptions} placeholder="select provider" value={createForm.providerPreset} onChange={(value) => applyPreset(value, 'create')} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>host</span>
              <input className={`${styles.input} ${styles.dataMono}`} placeholder={hostPlaceholder(createForm.providerPreset)} required value={createForm.host} onChange={(event) => setCreateForm((current) => ({ ...current, host: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>port</span>
              <input className={`${styles.input} ${styles.dataMono}`} min={1} type="number" value={createForm.port} onChange={(event) => setCreateForm((current) => ({ ...current, port: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>username</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.username} onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))} />
              <span className={styles.helper}>Leave blank for providers that don't require SIP registration (some local carriers).</span>
            </label>
            {createForm.username.trim() ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>password</span>
                <input className={`${styles.input} ${styles.dataMono}`} type="password" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} />
              </label>
            ) : null}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>from domain</span>
              <input className={`${styles.input} ${styles.dataMono}`} placeholder="provider.com" value={createForm.fromDomain} onChange={(event) => setCreateForm((current) => ({ ...current, fromDomain: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>from user</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.fromUser} onChange={(event) => setCreateForm((current) => ({ ...current, fromUser: event.target.value }))} />
            </label>
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} onClick={hideCreate} type="button">cancel</button>
              <button className={styles.primaryButton} type="submit">{busyKey === 'create' ? 'saving…' : 'save trunk'}</button>
            </div>
          </form>
          {errorText ? <div className={styles.failedText}>{errorText}</div> : null}
        </section>
      ) : null}

      <section className={styles.tablePanel}>
        <div className={styles.tableHead}>
          <div>Name</div>
          <div>Provider</div>
          <div>Host</div>
          <div>Port</div>
          <div>Auth</div>
          <div>Status</div>
          <div>Created</div>
          <div className={styles.actionsHeader}>Actions</div>
        </div>

        {sortedItems.length === 0 ? (
          <div className={styles.empty}>No trunks configured. Add your first SIP trunk.</div>
        ) : sortedItems.map((item) => {
          const presetLabel = PROVIDER_PRESETS[item.providerPreset as keyof typeof PROVIDER_PRESETS]?.label || item.providerPreset || 'Generic / Local';
          return (
            <Fragment key={item.id}>
              <div className={styles.row}>
                <div className={styles.rowValue}>{item.name}</div>
                <div className={styles.rowMuted}>{presetLabel}</div>
                <div className={styles.dataMono}>{item.host}</div>
                <div className={styles.dataMono}>{item.port}</div>
                <div className={styles.rowMuted}>{item.username ? 'Yes' : 'No'}</div>
                <div>
                  <button className={`${styles.toggleButton} ${item.enabled ? styles.toggleOn : styles.toggleOff}`} onClick={() => void handleToggleEnabled(item)} type="button">
                    {busyKey === `toggle-${item.id}` ? <span className={styles.spinner} /> : <span className={styles.toggleKnob} />}
                    <span>{item.enabled ? 'Enabled' : 'Disabled'}</span>
                  </button>
                </div>
                <div className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</div>
                <div className={styles.actionsCell}>
                  <div className={styles.actions}>
                    {confirmDeleteId === item.id ? (
                      <button className={styles.deleteConfirmButton} onClick={() => void handleDelete(item.id)} type="button">
                        {busyKey === `delete-${item.id}` ? 'Deleting…' : 'Confirm?'}
                      </button>
                    ) : (
                      <>
                        <button className={styles.secondaryButton} onClick={() => void handleTest(item)} type="button">
                          {busyKey === `test-${item.id}` ? <span className={styles.spinner} /> : <SignalIcon />}
                          <span>Test</span>
                        </button>
                        <button className={styles.secondaryButton} onClick={() => openEdit(item)} type="button">Edit</button>
                        <button className={styles.secondaryButton} onClick={() => setConfirmDeleteId(item.id)} type="button">Delete</button>
                      </>
                    )}
                  </div>
                  {renderTestBadge(item.id)}
                </div>
              </div>
              {editingId === item.id ? (
                <form className={styles.editorRow} onSubmit={(event) => void handleUpdate(event)}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>trunk name</span>
                    <input className={styles.input} required value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>provider preset</span>
                    <SearchableSelect options={presetOptions} placeholder="select provider" value={editForm.providerPreset} onChange={(value) => applyPreset(value, 'edit')} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>host</span>
                    <input className={`${styles.input} ${styles.dataMono}`} placeholder={hostPlaceholder(editForm.providerPreset)} required value={editForm.host} onChange={(event) => setEditForm((current) => ({ ...current, host: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>port</span>
                    <input className={`${styles.input} ${styles.dataMono}`} min={1} type="number" value={editForm.port} onChange={(event) => setEditForm((current) => ({ ...current, port: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>username</span>
                    <input className={`${styles.input} ${styles.dataMono}`} value={editForm.username} onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))} />
                    <span className={styles.helper}>Leave blank for providers that don't require SIP registration (some local carriers).</span>
                  </label>
                  {editForm.username.trim() ? (
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>password</span>
                      <input className={`${styles.input} ${styles.dataMono}`} type="password" value={editForm.password} onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))} />
                    </label>
                  ) : null}
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>from domain</span>
                    <input className={`${styles.input} ${styles.dataMono}`} placeholder="provider.com" value={editForm.fromDomain} onChange={(event) => setEditForm((current) => ({ ...current, fromDomain: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>from user</span>
                    <input className={`${styles.input} ${styles.dataMono}`} value={editForm.fromUser} onChange={(event) => setEditForm((current) => ({ ...current, fromUser: event.target.value }))} />
                  </label>
                  <div className={styles.formActions}>
                    <button className={styles.secondaryButton} onClick={hideEdit} type="button">cancel</button>
                    <button className={styles.primaryButton} type="submit">{busyKey === `edit-${item.id}` ? 'saving…' : 'save changes'}</button>
                  </div>
                </form>
              ) : null}
            </Fragment>
          );
        })}

        <Pagination page={page} totalPages={totalPages} onPageChange={(nextPage) => setOffset((nextPage - 1) * limit)} />
        {errorText ? <div className={styles.failedText}>{errorText}</div> : null}
      </section>
    </div>
  );
}
