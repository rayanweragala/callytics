import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { SearchableSelect } from '../components/common/SearchableSelect';
import {
  createContactNumber,
  deleteContactNumber,
  getContactNumbers,
  listTrunks,
  updateContactNumber,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import type { ContactNumber, SipTrunkItem } from '../types';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import styles from './ContactNumbersPage.module.css';

interface ContactForm {
  label: string;
  number: string;
  country: string;
  trunkId: string;
  notes: string;
}

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

const EMPTY_FORM: ContactForm = { label: '', number: '', country: 'US', trunkId: '', notes: '' };
const PAGE_LIMIT = 10;

export function ContactNumbersPage() {
  const windowWidth = useWindowWidth();
  const [items, setItems] = useState<ContactNumber[]>([]);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ContactForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [trunkError, setTrunkError] = useState<string | null>(null);
  const editPanelRef = useRef<HTMLDivElement | null>(null);

  const trunkOptions = useMemo(
    () => trunks.map((trunk) => ({ value: String(trunk.id), label: trunk.name })),
    [trunks],
  );
  const countryOptions = useMemo(
    () => COUNTRY_OPTIONS.map((option) => ({ value: option.code, label: `${option.code} — ${option.label}` })),
    [],
  );

  const trunkMap = useMemo(() => new Map(trunks.map((trunk) => [trunk.id, trunk.name])), [trunks]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const showPagination = total > 0;

  const load = async (nextPage = page) => {
    setLoadError(null);
    try {
      const [contactsRes, trunksRes] = await Promise.all([getContactNumbers(nextPage, PAGE_LIMIT), listTrunks(200, 0)]);
      setItems(contactsRes.data);
      setTotal(contactsRes.total);
      setTrunks(trunksRes.data);
    } catch (err) {
      setLoadError(getApiError(err, 'Failed to load contacts'));
    }
  };

  useEffect(() => {
    setLoading(true);
    void load(page).finally(() => setLoading(false));
  }, [page]);

  const submitCreate = async () => {
    const label = form.label.trim();
    const number = form.number.trim();
    if (!label || !number) {
      setError('Label and number are required');
      return;
    }
    if (!form.trunkId) {
      setTrunkError('A trunk is required to make outbound calls');
      return;
    }
    setCreating(true);
    setError(null);
    setTrunkError(null);
    try {
      await createContactNumber({
        label,
        number,
        country: form.country || 'US',
        trunk_id: Number(form.trunkId),
        notes: form.notes.trim() || undefined,
      });
      await load(1);
      setPage(1);
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(getApiError(err, 'Failed to create contact'));
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (item: ContactNumber) => {
    setTrunkError(null);
    setEditingId(item.id);
    setEditForm({
      label: item.label,
      number: item.number,
      country: 'US',
      trunkId: item.trunkId ? String(item.trunkId) : '',
      notes: item.notes || '',
    });
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setTrunkError(null);
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
      closeEdit();
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [editingId]);

  const submitEdit = async () => {
    if (editingId === null) return;
    if (!editForm.trunkId) {
      setTrunkError('A trunk is required to make outbound calls');
      return;
    }
    setSaving(true);
    setError(null);
    setTrunkError(null);
    try {
      const res = await updateContactNumber(editingId, {
        label: editForm.label.trim(),
        number: editForm.number.trim(),
        country: editForm.country || 'US',
        trunk_id: Number(editForm.trunkId),
        notes: editForm.notes.trim() || undefined,
      });
      setItems((prev) => prev.map((item) => (item.id === editingId ? res.data : item)));
      setEditingId(null);
      setEditForm(EMPTY_FORM);
    } catch (err) {
      setError(getApiError(err, 'Failed to update contact'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id: number) => {
    setDeletingId(id);
    setError(null);
    try {
      await deleteContactNumber(id);
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / PAGE_LIMIT)));
      await load(nextPage);
      if (nextPage !== page) setPage(nextPage);
      setConfirmDeleteId(null);
      if (editingId === id) {
        setEditingId(null);
      }
    } catch (err) {
      setError(getApiError(err, 'Failed to delete contact'));
    } finally {
      setDeletingId(null);
    }
  };

  const pageActions = (
    <button className={`${styles.primaryButton} btn-press`} type="button" onClick={() => setCreateOpen((v) => !v)}>
      {createOpen ? 'cancel' : 'add contact'}
    </button>
  );
  const blockingLoadError = !loading ? loadError : null;

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="Contacts" subtitle="configure" />
        {pageActions}
      </div>
      {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
      {!blockingLoadError ? (
        <>
      {createOpen ? (
        <div className={styles.formPanel}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>label</span>
            <input className={styles.input} value={form.label} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>number</span>
            <input className={styles.input} placeholder="+94714008762" value={form.number} onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>country</span>
            <SearchableSelect options={countryOptions} value={form.country || null} onChange={(value) => setForm((prev) => ({ ...prev, country: value || 'US' }))} placeholder="select country" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>trunk *</span>
            <SearchableSelect options={trunkOptions} value={form.trunkId || null} onChange={(value) => { setTrunkError(null); setForm((prev) => ({ ...prev, trunkId: value || '' })); }} placeholder="select trunk" />
            {trunkError && !editingId ? <span className={styles.inlineValidationError}>{trunkError}</span> : null}
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>notes</span>
            <input className={styles.input} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </label>
          <div className={styles.actions}>
            <button className={`${styles.primaryButton} btn-press`} type="button" onClick={() => void submitCreate()} disabled={creating}>{creating ? 'creating…' : 'create contact'}</button>
          </div>
        </div>
      ) : null}

      {error ? <ErrorMessage message={error} /> : null}

      <div className={styles.tableCard}>
        {loading ? (
          <div className={styles.emptyState}>loading…</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Number</th>
                <th>trunk</th>
                <th>notes</th>
                <th>created</th>
                <th className={styles.actionsHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>No contacts yet.</td>
                </tr>
              ) : items.map((item) => (
                <Fragment key={item.id}>
                  <tr className="table-row-hover">
                    <td className={styles.rowValue}>{item.label}</td>
                    <td className={styles.dataMono}>{item.number}</td>
                    <td className={styles.rowMuted}>{item.trunkId ? trunkMap.get(item.trunkId) || `#${item.trunkId}` : '—'}</td>
                    <td className={styles.rowMuted}>{item.notes || '—'}</td>
                    <td className={styles.createdAt}>{formatDateTime(item.createdAt)}</td>
                    <td>
                      <div className={styles.actionsInline}>
                        <>
                          <button className={`${styles.secondaryButton} ${styles.editButton}`} type="button" onClick={() => openEdit(item)}>edit</button>
                          <button className={`${styles.secondaryButton} ${styles.deleteButton}`} type="button" onClick={() => setConfirmDeleteId(item.id)}>delete</button>
                        </>
                      </div>
                    </td>
                  </tr>
                  {editingId === item.id ? (
                    <tr>
                      <td colSpan={6}>
                        <div className={styles.editPanel} ref={editPanelRef}>
                          <div className={styles.editPanelHeader}>
                            <span className={styles.fieldLabel}>edit contact</span>
                            <button className={styles.panelCloseButton} type="button" onClick={closeEdit} aria-label="Close edit panel">×</button>
                          </div>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>label</span>
                            <input className={styles.input} value={editForm.label} onChange={(event) => setEditForm((prev) => ({ ...prev, label: event.target.value }))} />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>number</span>
                            <input className={styles.input} value={editForm.number} onChange={(event) => setEditForm((prev) => ({ ...prev, number: event.target.value }))} />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>country</span>
                            <SearchableSelect options={countryOptions} value={editForm.country || null} onChange={(value) => setEditForm((prev) => ({ ...prev, country: value || 'US' }))} placeholder="select country" />
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>trunk *</span>
                            <SearchableSelect options={trunkOptions} value={editForm.trunkId || null} onChange={(value) => { setTrunkError(null); setEditForm((prev) => ({ ...prev, trunkId: value || '' })); }} placeholder="select trunk" />
                            {trunkError && editingId === item.id ? <span className={styles.inlineValidationError}>{trunkError}</span> : null}
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>notes</span>
                            <input className={styles.input} value={editForm.notes} onChange={(event) => setEditForm((prev) => ({ ...prev, notes: event.target.value }))} />
                          </label>
                          <div className={styles.actions}>
                            <button className={styles.secondaryButton} type="button" onClick={closeEdit} disabled={saving}>cancel</button>
                            <button className={`${styles.primaryButton} btn-press`} type="button" onClick={() => void submitEdit()} disabled={saving}>{saving ? 'saving…' : 'save'}</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {showPagination ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        ) : null}
      </div>
        </>
      ) : null}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete contact"
        message="Delete this contact? This cannot be undone."
        cancelLabel="cancel"
        confirmLabel={confirmDeleteId !== null && deletingId === confirmDeleteId ? 'deleting…' : 'delete'}
        isLoading={deletingId !== null}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId !== null) {
            void confirmDelete(confirmDeleteId);
          }
        }}
      />
    </div>
  );
}
