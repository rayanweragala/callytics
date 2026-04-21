import { Fragment, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { SkeletonRow } from '../components/common/skeleton';
import { SearchableSelect } from '../components/common/SearchableSelect';
import {
  createOperator,
  deleteOperator,
  getContactNumbers,
  listExtensions,
  listOperators,
  updateOperator,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { ContactNumber, ExtensionItem, OperatorItem } from '../types';
import styles from './OperatorsPage.module.css';

const OPERATOR_DESTINATION_REQUIRED = 'An operator must have at least an extension or a PSTN contact assigned.';

function StatusBadge({ status }: { status: OperatorItem['status'] }) {
  const cls =
    status === 'available'
      ? styles.statusAvailable
      : status === 'busy'
      ? styles.statusBusy
      : styles.statusOffline;
  return <span className={`${styles.statusBadge} ${cls}`}>{status}</span>;
}

interface OperatorFormState {
  name: string;
  extensionId: string;
  contactNumberId: string;
  pin: string;
}

const emptyForm: OperatorFormState = { name: '', extensionId: '', contactNumberId: '', pin: '' };

export function OperatorsPage() {
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [contactNumbers, setContactNumbers] = useState<ContactNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<OperatorFormState>(emptyForm);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<OperatorFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = (msg: string | null) => {
    setErrorText(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) errorTimerRef.current = setTimeout(() => setErrorText(null), 6000);
  };

  const load = useCallback(async () => {
    try {
      const [opRes, extRes, contactsRes] = await Promise.all([listOperators(), listExtensions(200, 0), getContactNumbers()]);
      setOperators(opRes.data);
      setExtensions(extRes.data);
      setContactNumbers(contactsRes.data);
    } catch {
      // keep stale data
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    pollTimer.current = setInterval(() => { void load(); }, 10_000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [load]);

  const extensionOptions = extensions.map((ext) => ({
    value: String(ext.id),
    label: ext.displayName ? `${ext.username} — ${ext.displayName}` : ext.username,
  }));

  const contactOptions = contactNumbers.map((item) => ({
    value: String(item.id),
    label: `${item.label} — ${item.number}`,
  }));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createForm.name.trim();
    if (!name) {
      showError('Name is required');
      return;
    }
    if (!createForm.extensionId && !createForm.contactNumberId) {
      showError(OPERATOR_DESTINATION_REQUIRED);
      return;
    }
    setCreating(true);
    showError(null);
    try {
      const res = await createOperator({
        name,
        extension_id: createForm.extensionId ? Number(createForm.extensionId) : undefined,
        contact_number_id: createForm.contactNumberId ? Number(createForm.contactNumberId) : undefined,
        pin: createForm.pin.trim() || undefined,
      });
      const created = res.data;
      setOperators((prev) => [...prev, created]);
      setCreateForm(emptyForm);
      setCreateOpen(false);
    } catch (err) {
      showError(getApiError(err, 'Failed to create operator'));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (op: OperatorItem) => {
    showError(null);
    setCreateOpen(false);
    setConfirmDeleteId(null);
    setEditingId(op.id);
    setEditForm({
      name: op.name,
      extensionId: op.extension?.id ? String(op.extension.id) : '',
      contactNumberId: op.contactNumber?.id ? String(op.contactNumber.id) : '',
      pin: '',
    });
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null) return;
    if (!editForm.extensionId && !editForm.contactNumberId) {
      showError(OPERATOR_DESTINATION_REQUIRED);
      return;
    }
    setSaving(true);
    showError(null);
    try {
      const res = await updateOperator(editingId, {
        name: editForm.name.trim(),
        extension_id: editForm.extensionId ? Number(editForm.extensionId) : undefined,
        contact_number_id: editForm.contactNumberId ? Number(editForm.contactNumberId) : undefined,
        pin: editForm.pin.trim() || undefined,
      });
      setOperators((prev) => prev.map((op) => (op.id === editingId ? { ...op, ...res.data } : op)));
      setEditingId(null);
      setEditForm(emptyForm);
    } catch (err) {
      showError(getApiError(err, 'Failed to update operator'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    showError(null);
    try {
      await deleteOperator(id);
      setConfirmDeleteId(null);
      setOperators((prev) => prev.filter((op) => op.id !== id));
      if (editingId === id) {
        setEditingId(null);
      }
    } catch (err) {
      showError(getApiError(err, 'Failed to delete operator'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <PageLayout title="Operators" subtitle="Manage call center operators and queue assignments">
      <div className={styles.page}>
        <div className={styles.header}>
          <div>
            <div className={styles.sectionLabel}>Call Center</div>
            <h1 className={styles.title}>operators</h1>
          </div>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => {
              showError(null);
              setEditingId(null);
              setConfirmDeleteId(null);
              setCreateOpen((current) => !current);
            }}
          >
            {createOpen ? 'cancel' : '+ add operator'}
          </button>
        </div>

        {createOpen ? (
          <section className={styles.formPanel}>
            <div className={styles.panelTitle}>new operator</div>
            <form className={styles.formGrid} onSubmit={(e) => void handleCreate(e)}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>name</span>
                <input
                  className={styles.input}
                  placeholder="e.g. Alice"
                  value={createForm.name}
                  onChange={(e) => { showError(null); setCreateForm((f) => ({ ...f, name: e.target.value })); }}
                  disabled={creating}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>SIP extension (optional)</span>
                <SearchableSelect
                  options={extensionOptions}
                  value={createForm.extensionId || null}
                  onChange={(v) => { showError(null); setCreateForm((f) => ({ ...f, extensionId: v || '' })); }}
                  placeholder="No extension assigned"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>PSTN fallback (optional)</span>
                <SearchableSelect
                  options={contactOptions}
                  value={createForm.contactNumberId || null}
                  onChange={(v) => { showError(null); setCreateForm((f) => ({ ...f, contactNumberId: v || '' })); }}
                  placeholder="No PSTN contact"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>PIN (optional)</span>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="set a 4-6 digit PIN"
                  value={createForm.pin}
                  onChange={(e) => { showError(null); setCreateForm((f) => ({ ...f, pin: e.target.value })); }}
                  disabled={creating}
                />
                <span className={styles.inlineHint}>Optional — a random PIN will be generated if omitted.</span>
              </label>
              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="submit" disabled={creating}>
                  {creating ? 'creating…' : 'add operator'}
                </button>
              </div>
              {errorText === OPERATOR_DESTINATION_REQUIRED ? <div className={styles.inlineValidationError}>{OPERATOR_DESTINATION_REQUIRED}</div> : null}
            </form>
            {errorText && errorText !== OPERATOR_DESTINATION_REQUIRED ? <ErrorMessage message={errorText} /> : null}
          </section>
        ) : null}

        <section className={styles.tablePanel}>
          <div className={styles.tableHead}>
            <div>name</div>
            <div>extension</div>
            <div>pstn fallback</div>
            <div>status</div>
            <div>created</div>
            <div className={styles.actionsHeader}>actions</div>
          </div>
          {loading && operators.length === 0 ? (
            <>
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonRow key={i} columns={[
                  { width: '180px' },
                  { width: '160px' },
                  { width: '160px' },
                  { width: '80px' },
                  { width: '140px' },
                  { width: '200px' },
                ]} />
              ))}
            </>
          ) : operators.length === 0 ? (
            <div className={styles.empty}>No operators yet. Add one above.</div>
          ) : (
            <div className="fadeIn">
              {operators.map((op) => (
                <Fragment key={op.id}>
                  <div className={styles.row}>
                    <div className={styles.dataMono}>{op.name}</div>
                    <div className={styles.dataMono}>{op.extension?.username || '—'}</div>
                    <div className={styles.dataMono}>{op.contactNumber?.label || '—'}</div>
                    <StatusBadge status={op.status} />
                    <div className={styles.createdAt}>{formatDateTime(op.createdAt)}</div>
                    <div className={styles.actions}>
                      {confirmDeleteId === op.id ? (
                        <div className={styles.confirmBox}>
                          <div className={styles.confirmText}>Delete this operator? They will be logged out.</div>
                          <div className={styles.confirmActions}>
                            <button className={styles.secondaryButton} type="button" onClick={() => setConfirmDeleteId(null)}>cancel</button>
                            <button className={styles.deleteButton} type="button" onClick={() => void handleDelete(op.id)}>
                              {deletingId === op.id ? 'deleting…' : 'delete'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button className={styles.secondaryButton} type="button" onClick={() => openEdit(op)}>edit</button>
                          <button className={styles.secondaryButton} type="button" onClick={() => setConfirmDeleteId(op.id)}>delete</button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingId === op.id ? (
                    <form className={styles.editorRow} onSubmit={(e) => void handleUpdate(e)}>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>name</span>
                        <input
                          className={styles.input}
                          value={editForm.name}
                          onChange={(e) => { showError(null); setEditForm((f) => ({ ...f, name: e.target.value })); }}
                          disabled={saving}
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>SIP extension</span>
                        <SearchableSelect
                          options={extensionOptions}
                          value={editForm.extensionId || null}
                          onChange={(v) => { showError(null); setEditForm((f) => ({ ...f, extensionId: v || '' })); }}
                          placeholder="No extension assigned"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>PSTN fallback</span>
                        <SearchableSelect
                          options={contactOptions}
                          value={editForm.contactNumberId || null}
                          onChange={(v) => { showError(null); setEditForm((f) => ({ ...f, contactNumberId: v || '' })); }}
                          placeholder="No PSTN contact"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>PIN (optional)</span>
                        <input
                          className={styles.input}
                          type="password"
                          placeholder={op.hasPIN ? 'leave blank to keep existing PIN' : 'set a 4-6 digit PIN'}
                          value={editForm.pin}
                          onChange={(e) => { showError(null); setEditForm((f) => ({ ...f, pin: e.target.value })); }}
                          disabled={saving}
                        />
                        <span className={styles.inlineHint}>{op.hasPIN ? 'Leave blank to keep the current PIN hash.' : 'Optional — a random PIN will be generated if omitted.'}</span>
                      </label>
                      <div className={styles.formActions}>
                        <button className={styles.secondaryButton} type="button" onClick={() => setEditingId(null)} disabled={saving}>cancel</button>
                        <button className={styles.primaryButton} type="submit" disabled={saving}>
                          {saving ? 'saving…' : 'save changes'}
                        </button>
                      </div>
                      {errorText === OPERATOR_DESTINATION_REQUIRED ? <div className={styles.inlineValidationError}>{OPERATOR_DESTINATION_REQUIRED}</div> : null}
                      {errorText && errorText !== OPERATOR_DESTINATION_REQUIRED ? <ErrorMessage message={errorText} /> : null}
                    </form>
                  ) : null}
                </Fragment>
              ))}
            </div>
          )}
          {!createOpen && errorText && editingId === null ? <ErrorMessage message={errorText} /> : null}
        </section>
      </div>
    </PageLayout>
  );
}
