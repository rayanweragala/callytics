import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import type { ContactNumber, SipTrunkItem } from '../types';
import styles from './ContactNumbersPage.module.css';

interface ContactForm {
  label: string;
  number: string;
  trunkId: string;
  notes: string;
}

const EMPTY_FORM: ContactForm = { label: '', number: '', trunkId: '', notes: '' };
const PAGE_LIMIT = 10;

export function ContactNumbersPage() {
  const [items, setItems] = useState<ContactNumber[]>([]);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);
  const [loading, setLoading] = useState(true);
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

  const trunkOptions = useMemo(
    () => trunks.map((trunk) => ({ value: String(trunk.id), label: trunk.name })),
    [trunks],
  );

  const trunkMap = useMemo(() => new Map(trunks.map((trunk) => [trunk.id, trunk.name])), [trunks]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const load = async (nextPage = page) => {
    try {
      const [contactsRes, trunksRes] = await Promise.all([getContactNumbers(nextPage, PAGE_LIMIT), listTrunks(200, 0)]);
      setItems(contactsRes.data);
      setTotal(contactsRes.total);
      setTrunks(trunksRes.data);
    } catch (err) {
      setError(getApiError(err, 'Failed to load contacts'));
    }
  };

  useEffect(() => {
    setLoading(true);
    void load(page).finally(() => setLoading(false));
  }, [page]);

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const label = form.label.trim();
    const number = form.number.trim();
    if (!label || !number) {
      setError('Label and number are required');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createContactNumber({
        label,
        number,
        trunk_id: form.trunkId ? Number(form.trunkId) : undefined,
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
    setEditingId(item.id);
    setEditForm({
      label: item.label,
      number: item.number,
      trunkId: item.trunkId ? String(item.trunkId) : '',
      notes: item.notes || '',
    });
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await updateContactNumber(editingId, {
        label: editForm.label.trim(),
        number: editForm.number.trim(),
        trunk_id: editForm.trunkId ? Number(editForm.trunkId) : null,
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
    <button className={styles.primaryButton} type="button" onClick={() => setCreateOpen((v) => !v)}>
      {createOpen ? 'cancel' : 'add contact'}
    </button>
  );

  return (
    <PageLayout actions={pageActions} title="Contacts" subtitle="configure">
      <div className={styles.page}>

        {createOpen ? (
          <form className={styles.formPanel} onSubmit={(event) => void submitCreate(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>label</span>
              <input className={styles.input} value={form.label} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>number</span>
              <input className={styles.input} placeholder="+94714008762" value={form.number} onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>trunk</span>
              <SearchableSelect options={trunkOptions} value={form.trunkId || null} onChange={(value) => setForm((prev) => ({ ...prev, trunkId: value || '' }))} placeholder="optional trunk" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>notes</span>
              <input className={styles.input} value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
            </label>
            <div className={styles.actions}>
              <button className={styles.primaryButton} type="submit" disabled={creating}>{creating ? 'creating…' : 'create contact'}</button>
            </div>
          </form>
        ) : null}

        {error ? <ErrorMessage message={error} /> : null}

        <section className={styles.tablePanel}>
          <div className={styles.tableHead}>
            <div>label</div>
            <div>number</div>
            <div>trunk</div>
            <div>notes</div>
            <div>created</div>
            <div className={styles.actionsHeader}>actions</div>
          </div>
          {loading ? <div className={styles.empty}>loading…</div> : null}
          {!loading && items.length === 0 ? <div className={styles.empty}>No contacts yet.</div> : null}
          {!loading && items.map((item) => (
            <div key={item.id} className={styles.rowWrap}>
              <div className={styles.row}>
                <div className={styles.rowValue}>{item.label}</div>
                <div className={styles.dataMono}>{item.number}</div>
                <div className={styles.rowMuted}>{item.trunkId ? trunkMap.get(item.trunkId) || `#${item.trunkId}` : '—'}</div>
                <div className={styles.rowMuted}>{item.notes || '—'}</div>
                <div className={styles.createdAt}>{formatDateTime(item.createdAt)}</div>
                <div className={styles.actionsInline}>
                  {confirmDeleteId === item.id ? (
                    <ConfirmDialog
                      inline
                      open
                      title="Delete contact"
                      message="Delete this contact? This cannot be undone."
                      cancelLabel="cancel"
                      confirmLabel={deletingId === item.id ? 'deleting…' : 'delete'}
                      onCancel={() => setConfirmDeleteId(null)}
                      onConfirm={() => void confirmDelete(item.id)}
                    />
                  ) : (
                    <>
                      <button className={styles.secondaryButton} type="button" onClick={() => openEdit(item)}>edit</button>
                      <button className={styles.secondaryButton} type="button" onClick={() => setConfirmDeleteId(item.id)}>delete</button>
                    </>
                  )}
                </div>
              </div>
              {editingId === item.id ? (
                <form className={styles.editPanel} onSubmit={(event) => void submitEdit(event)}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>label</span>
                    <input className={styles.input} value={editForm.label} onChange={(event) => setEditForm((prev) => ({ ...prev, label: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>number</span>
                    <input className={styles.input} value={editForm.number} onChange={(event) => setEditForm((prev) => ({ ...prev, number: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>trunk</span>
                    <SearchableSelect options={trunkOptions} value={editForm.trunkId || null} onChange={(value) => setEditForm((prev) => ({ ...prev, trunkId: value || '' }))} placeholder="optional trunk" />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>notes</span>
                    <input className={styles.input} value={editForm.notes} onChange={(event) => setEditForm((prev) => ({ ...prev, notes: event.target.value }))} />
                  </label>
                  <div className={styles.actions}>
                    <button className={styles.secondaryButton} type="button" onClick={() => setEditingId(null)} disabled={saving}>cancel</button>
                    <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? 'saving…' : 'save'}</button>
                  </div>
                </form>
              ) : null}
            </div>
          ))}
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </section>
      </div>
    </PageLayout>
  );
}
