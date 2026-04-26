import { Fragment, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import {
  createOperator,
  deleteOperator,
  getContactNumbers,
  listExtensions,
  listOperators,
  listTrunks,
  updateOperator,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { ContactNumber, ExtensionItem, OperatorItem, SipTrunkItem } from '../types';
import styles from './OperatorsPage.module.css';

const OPERATOR_DESTINATION_REQUIRED = 'An operator must have at least an extension or a PSTN contact assigned.';
const PAGE_LIMIT = 10;

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
  callbackNumber: string;
  callbackTrunkId: string;
  pin: string;
}

const emptyForm: OperatorFormState = { name: '', extensionId: '', contactNumberId: '', callbackNumber: '', callbackTrunkId: '', pin: '' };

export function OperatorsPage() {
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [revealedPins, setRevealedPins] = useState<Set<number>>(new Set());
  const [newOperatorPin, setNewOperatorPin] = useState<string | null>(null);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [contactNumbers, setContactNumbers] = useState<ContactNumber[]>([]);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const load = useCallback(async (nextPage = page) => {
    try {
      const [opRes, extRes, contactsRes, trunksRes] = await Promise.all([
        listOperators(nextPage, PAGE_LIMIT),
        listExtensions(200, 0),
        getContactNumbers(1, 200),
        listTrunks(200, 0),
      ]);
      setOperators(opRes.data);
      setTotal(opRes.total);
      setExtensions(extRes.data);
      setContactNumbers(contactsRes.data);
      setTrunks(trunksRes.data);
    } catch {
      // keep stale data
    }
  }, [page]);

  useEffect(() => {
    setLoading(true);
    load(page).finally(() => setLoading(false));
    pollTimer.current = setInterval(() => { void load(page); }, 10_000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [load, page]);

  const extensionOptions = extensions.map((ext) => ({
    value: String(ext.id),
    label: ext.displayName ? `${ext.username} — ${ext.displayName}` : ext.username,
  }));

  const contactOptions = contactNumbers.map((item) => ({
    value: String(item.id),
    label: `${item.label} — ${item.number}`,
  }));
  const trunkOptions = trunks.map((item) => ({
    value: String(item.id),
    label: item.name,
  }));

  const handleCreate = async () => {
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
        callback_number: createForm.callbackNumber.trim() || undefined,
        callback_trunk_id: createForm.callbackTrunkId ? Number(createForm.callbackTrunkId) : undefined,
        pin: createForm.pin.trim() || undefined,
      });
      const created = res.data;
      await load(1);
      setPage(1);
      setNewOperatorPin(created.pin ?? (createForm.pin.trim() || null));
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
      callbackNumber: op.callbackNumber || '',
      callbackTrunkId: op.callbackTrunkId ? String(op.callbackTrunkId) : '',
      pin: '',
    });
  };

  const handleUpdate = async () => {
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
        callback_number: editForm.callbackNumber.trim() || undefined,
        callback_trunk_id: editForm.callbackTrunkId ? Number(editForm.callbackTrunkId) : undefined,
        pin: editForm.pin.trim() || undefined,
      });
      await load(page);
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
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / PAGE_LIMIT)));
      await load(nextPage);
      if (nextPage !== page) setPage(nextPage);
      setRevealedPins((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (editingId === id) {
        setEditingId(null);
      }
    } catch (err) {
      showError(getApiError(err, 'Failed to delete operator'));
    } finally {
      setDeletingId(null);
    }
  };

  const togglePinVisibility = (id: number) => {
    setRevealedPins((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pageActions = (
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
      {createOpen ? 'cancel' : 'add operator'}
    </button>
  );

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageLayout title="Operators" subtitle="configure" />
        {pageActions}
      </div>
      {createOpen ? (
        <section className={styles.formPanel}>
          <div className={styles.panelTitle}>new operator</div>
          <div className={styles.formGrid}>
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
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Callback Number (PSTN)</span>
              <input
                className={styles.input}
                placeholder="+94771234567"
                value={createForm.callbackNumber}
                onChange={(e) => { showError(null); setCreateForm((f) => ({ ...f, callbackNumber: e.target.value })); }}
                disabled={creating}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Callback Trunk</span>
              <SearchableSelect
                options={trunkOptions}
                value={createForm.callbackTrunkId || null}
                onChange={(v) => { showError(null); setCreateForm((f) => ({ ...f, callbackTrunkId: v || '' })); }}
                placeholder="No callback trunk"
              />
            </label>
            <div className={styles.formActions}>
              <button className={styles.primaryButton} type="button" onClick={() => void handleCreate()} disabled={creating}>
                {creating ? 'creating…' : 'add operator'}
              </button>
            </div>
            {errorText === OPERATOR_DESTINATION_REQUIRED ? <div className={styles.inlineValidationError}>{OPERATOR_DESTINATION_REQUIRED}</div> : null}
          </div>
          {errorText && errorText !== OPERATOR_DESTINATION_REQUIRED ? <ErrorMessage message={errorText} /> : null}
        </section>
      ) : null}

      {newOperatorPin ? (
        <div className={styles.pinBanner} role="status" aria-live="polite">
          <div className={styles.pinBannerText}>
            <span>Operator created. PIN: </span>
            <span className={styles.pinValue}>{newOperatorPin}</span>
            <span> — save this now, it will be masked after you close this message.</span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => setNewOperatorPin(null)}
          >
            Got it
          </button>
        </div>
      ) : null}

      <div className={styles.tableCard}>
        {loading && operators.length === 0 ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '180px' },
                { width: '160px' },
                { width: '160px' },
                { width: '140px' },
                { width: '80px' },
                { width: '140px' },
                { width: '200px' },
              ]} />
            ))}
          </>
        ) : operators.length === 0 ? (
          <div className={styles.emptyState}>No operators yet. Add one above.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>name</th>
                <th>extension</th>
                <th>pstn fallback</th>
                <th>pin</th>
                <th>status</th>
                <th>created</th>
                <th className={styles.actionsHeader}>actions</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => (
                <Fragment key={op.id}>
                  <tr>
                    <td className={styles.rowValue}>{op.name}</td>
                    <td className={styles.dataMono}>{op.extension?.username || '—'}</td>
                    <td className={styles.rowMuted}>{op.contactNumber?.label || '—'}</td>
                    <td>
                      <div className={styles.pinCell}>
                        <span className={`${styles.dataMono} ${revealedPins.has(op.id) ? styles.pinRevealedValue : ''}`}>
                          {revealedPins.has(op.id) ? op.pin || '••••••' : '••••••'}
                        </span>
                        <button
                          className={styles.pinToggle}
                          type="button"
                          onClick={() => togglePinVisibility(op.id)}
                          aria-label={revealedPins.has(op.id) ? `Hide PIN for ${op.name}` : `Show PIN for ${op.name}`}
                        >
                          {revealedPins.has(op.id) ? '[hide]' : '[show]'}
                        </button>
                      </div>
                    </td>
                    <td><StatusBadge status={op.status} /></td>
                    <td className={styles.createdAt}>{formatDateTime(op.createdAt)}</td>
                    <td className={styles.actionsCell}>
                      <div className={styles.actions}>
                        <>
                          <button className={`${styles.secondaryButton} ${styles.editButton}`} type="button" onClick={() => openEdit(op)}>edit</button>
                          <button className={`${styles.secondaryButton} ${styles.deleteButton}`} type="button" onClick={() => setConfirmDeleteId(op.id)}>delete</button>
                        </>
                      </div>
                    </td>
                  </tr>
                  {editingId === op.id ? (
                    <tr className={styles.editRow}>
                      <td className={styles.editCell} colSpan={7}>
                        <div className={styles.editPanel}>
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
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Callback Number (PSTN)</span>
                            <input
                              className={styles.input}
                              placeholder="+94771234567"
                              value={editForm.callbackNumber}
                              onChange={(e) => { showError(null); setEditForm((f) => ({ ...f, callbackNumber: e.target.value })); }}
                              disabled={saving}
                            />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Callback Trunk</span>
                            <SearchableSelect
                              options={trunkOptions}
                              value={editForm.callbackTrunkId || null}
                              onChange={(v) => { showError(null); setEditForm((f) => ({ ...f, callbackTrunkId: v || '' })); }}
                              placeholder="No callback trunk"
                            />
                          </label>
                          <div className={styles.formActions}>
                            <button className={styles.secondaryButton} type="button" onClick={() => setEditingId(null)} disabled={saving}>cancel</button>
                            <button className={styles.primaryButton} type="button" onClick={() => void handleUpdate()} disabled={saving}>
                              {saving ? 'saving…' : 'save changes'}
                            </button>
                          </div>
                          {errorText === OPERATOR_DESTINATION_REQUIRED ? <div className={styles.inlineValidationError}>{OPERATOR_DESTINATION_REQUIRED}</div> : null}
                          {errorText && errorText !== OPERATOR_DESTINATION_REQUIRED ? <div className={styles.inlineError}><ErrorMessage message={errorText} /></div> : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
        {!createOpen && errorText && editingId === null ? <ErrorMessage message={errorText} /> : null}
        <ConfirmDialog
          open={confirmDeleteId !== null}
          title="Delete operator"
          message="Delete this operator? They will be logged out."
          cancelLabel="cancel"
          confirmLabel={confirmDeleteId !== null && deletingId === confirmDeleteId ? 'deleting…' : 'delete'}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            if (confirmDeleteId !== null) {
              void handleDelete(confirmDeleteId);
            }
          }}
        />
      </div>
    </div>
  );
}
