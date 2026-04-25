import { FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import {
  createQueue,
  deleteQueue,
  listAllAudio,
  listOperators,
  listQueues,
  updateQueue,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { AudioFileItem, OperatorItem, QueueItem } from '../types';
import styles from './QueuesPage.module.css';

const PAGE_LIMIT = 10;

interface EditState {
  queueId: number;
  name: string;
  waitAudioFileId: number | null;
  maxWaitSeconds: number;
  pinRetryAttempts: number;
  operatorIds: number[];
}

function OperatorPickerRow({
  allOperators,
  selectedIds,
  onChange,
}: {
  allOperators: OperatorItem[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const unselected = allOperators.filter((op) => !selectedIds.includes(op.id));
  return (
    <div>
      <div className={styles.operatorTagList}>
        {selectedIds.map((id) => {
          const op = allOperators.find((o) => o.id === id);
          if (!op) return null;
          return (
            <span className={styles.operatorTag} key={id}>
              {op.name}
              <button
                className={styles.tagRemove}
                type="button"
                aria-label={`Remove ${op.name}`}
                onClick={() => onChange(selectedIds.filter((x) => x !== id))}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {unselected.length > 0 ? (
        <select
          className={styles.select}
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id && !selectedIds.includes(id)) onChange([...selectedIds, id]);
          }}
          style={{ marginTop: selectedIds.length > 0 ? 8 : 0 }}
        >
          <option value="">add operator</option>
          {unselected.map((op) => (
            <option key={op.id} value={op.id}>{op.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export function QueuesPage() {
  const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [audioItems, setAudioItems] = useState<AudioFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createWaitAudioId, setCreateWaitAudioId] = useState<number | null>(null);
  const [createMaxWait, setCreateMaxWait] = useState(300);
  const [createPinRetries, setCreatePinRetries] = useState(3);
  const [createOperatorIds, setCreateOperatorIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [errorText, setErrorText] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const load = useCallback(async (nextPage = page) => {
    const [qRes, oRes, aRes] = await Promise.allSettled([
      listQueues(nextPage, PAGE_LIMIT),
      listOperators(1, 200),
      listAllAudio(),
    ]);
    if (qRes.status === 'fulfilled') {
      setQueues(qRes.value.data);
      setTotal(qRes.value.total);
    }
    if (oRes.status === 'fulfilled') {
      setOperators(oRes.value.data);
    }
    if (aRes.status === 'fulfilled') {
      setAudioItems(aRes.value.data);
    }
  }, [page]);

  useEffect(() => {
    setLoading(true);
    load(page).finally(() => setLoading(false));
  }, [load, page]);

  const audioOptions = audioItems.map((a) => ({
    value: String(a.id),
    label: a.name,
  }));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name) { setErrorText('Name is required'); return; }
    if (createOperatorIds.length === 0) {
      setErrorText('At least one operator is required.');
      return;
    }
    setCreating(true);
    setErrorText(null);
    try {
      const res = await createQueue({
        name,
        wait_audio_file_id: createWaitAudioId,
        max_wait_seconds: createMaxWait,
        pin_retry_attempts: createPinRetries,
        operator_ids: createOperatorIds,
      });
      await load(1);
      setPage(1);
      setCreateName('');
      setCreateWaitAudioId(null);
      setCreateMaxWait(300);
      setCreatePinRetries(3);
      setCreateOperatorIds([]);
      setCreateOpen(false);
    } catch (err: unknown) {
      setErrorText(getApiError(err, 'Failed to create queue'));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (q: QueueItem) => {
    setErrorText(null);
    setCreateOpen(false);
    setConfirmDeleteId(null);
    setEditState({
      queueId: q.id,
      name: q.name,
      waitAudioFileId: q.waitAudioFileId,
      maxWaitSeconds: q.maxWaitSeconds,
      pinRetryAttempts: q.pinRetryAttempts,
      operatorIds: q.operatorIds,
    });
  };

  const cancelEdit = () => {
    setEditState(null);
    setErrorText(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editState) return;
    if (editState.operatorIds.length === 0) {
      setErrorText('At least one operator is required.');
      return;
    }
    setSaving(true);
    setErrorText(null);
    try {
      const res = await updateQueue(editState.queueId, {
        name: editState.name.trim(),
        wait_audio_file_id: editState.waitAudioFileId,
        max_wait_seconds: editState.maxWaitSeconds,
        pin_retry_attempts: editState.pinRetryAttempts,
        operator_ids: editState.operatorIds,
      });
      await load(page);
      setEditState(null);
    } catch (err: unknown) {
      setErrorText(getApiError(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setErrorText(null);
    try {
      await deleteQueue(id);
      const nextTotal = Math.max(0, total - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotal / PAGE_LIMIT)));
      await load(nextPage);
      if (nextPage !== page) setPage(nextPage);
      setConfirmDeleteId(null);
      if (editState?.queueId === id) setEditState(null);
    } catch (err: unknown) {
      setErrorText(getApiError(err, 'Delete failed'));
    } finally {
      setDeletingId(null);
    }
  };

  const pageActions = (
    <button
      className={styles.primaryButton}
      type="button"
      onClick={() => {
        setErrorText(null);
        setEditState(null);
        setConfirmDeleteId(null);
        setCreateOpen((c) => !c);
      }}
    >
      {createOpen ? 'cancel' : 'add queue'}
    </button>
  );

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageLayout title="Queues" subtitle="configure" />
        {pageActions}
      </div>
        {/* Create form */}
        {createOpen ? (
          <div className={styles.formPanel}>
            <div className={styles.panelTitle}>new queue</div>
            <form onSubmit={(e) => { void handleCreate(e); }}>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>name</span>
                    <input
                      className={styles.input}
                      placeholder="e.g. Support Queue"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      disabled={creating}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>max wait (sec)</span>
                    <input
                      className={styles.input}
                      type="number"
                      min={1}
                      value={createMaxWait}
                      onChange={(e) => setCreateMaxWait(Math.max(1, Number(e.target.value) || 300))}
                      disabled={creating}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>PIN retries</span>
                    <input
                      className={styles.input}
                      type="number"
                      min={1}
                      value={createPinRetries}
                      onChange={(e) => setCreatePinRetries(Math.max(1, Number(e.target.value) || 3))}
                      disabled={creating}
                    />
                  </label>
                </div>
                <div className={styles.formRow}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>wait audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={createWaitAudioId ? String(createWaitAudioId) : null}
                      onChange={(val) => setCreateWaitAudioId(val ? Number(val) : null)}
                      placeholder="select audio file…"
                    />
                    {createWaitAudioId ? (
                      (() => {
                        const item = audioItems.find(a => a.id === createWaitAudioId);
                        const srcPath = item?.previewUrl || item?.originalUrl;
                        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={createWaitAudioId} src={`${BASE}${srcPath}`} /> : null;
                      })()
                    ) : null}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>operators</span>
                    <OperatorPickerRow
                      allOperators={operators}
                      selectedIds={createOperatorIds}
                      onChange={setCreateOperatorIds}
                    />
                  </label>
                </div>
                <div className={styles.formActions}>
                  <button className={styles.primaryButton} type="submit" disabled={creating}>
                    {creating ? 'creating…' : 'add queue'}
                  </button>
                </div>
              </div>
              {errorText ? <ErrorMessage message={errorText} /> : null}
            </form>
          </div>
        ) : null}

        {/* Table */}
        <div className={styles.tableCard}>
          {loading && queues.length === 0 ? (
            <>
              {Array.from({ length: 3 }, (_, i) => (
                <SkeletonRow key={i} columns={[
                  { width: '200px' },
                  { width: '1fr' },
                  { width: '100px' },
                  { width: '100px' },
                  { width: '140px' },
                  { width: '160px' },
                ]} />
              ))}
            </>
          ) : queues.length === 0 ? (
            <div className={styles.emptyState}>No queues yet. Add one above.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>name</th>
                  <th>operators</th>
                  <th>max wait</th>
                  <th>PIN retries</th>
                  <th>created</th>
                  <th>actions</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <Fragment key={q.id}>
                    <tr>
                      <td className={styles.dataMono}>{q.name}</td>
                      <td className={styles.dataMono}>{q.operators.map((o) => o.name).join(', ') || '—'}</td>
                      <td className={styles.dataMono}>{q.maxWaitSeconds}s</td>
                      <td className={styles.dataMono}>{q.pinRetryAttempts}</td>
                      <td className={styles.createdAt}>{formatDateTime(q.createdAt)}</td>
                      <td>
                        <div className={styles.actions}>
                          {confirmDeleteId === q.id ? (
                            <div className={styles.confirmBox}>
                              <div className={styles.confirmText}>Delete this queue? This cannot be undone.</div>
                              <div className={styles.confirmActions}>
                                <button className={styles.cancelButton} type="button" onClick={() => setConfirmDeleteId(null)}>cancel</button>
                                <button className={styles.deleteButton} type="button" onClick={() => void handleDelete(q.id)}>
                                  {deletingId === q.id ? 'deleting…' : 'delete'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button
                                className={styles.editButton}
                                type="button"
                                onClick={() => startEdit(q)}
                              >
                                edit
                              </button>
                              <button
                                className={styles.cancelButton}
                                type="button"
                                onClick={() => setConfirmDeleteId(q.id)}
                              >
                                delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {editState?.queueId === q.id ? (
                      <tr>
                        <td colSpan={6}>
                          <form className={styles.editorRow} onSubmit={(e) => void handleSave(e)}>
                            <div className={styles.formGrid}>
                              <div className={styles.formRow}>
                                <label className={styles.field}>
                                  <span className={styles.fieldLabel}>name</span>
                                  <input
                                    className={styles.input}
                                    value={editState.name}
                                    onChange={(e) => setEditState((s) => s ? { ...s, name: e.target.value } : s)}
                                    disabled={saving}
                                  />
                                </label>
                                <label className={styles.field}>
                                  <span className={styles.fieldLabel}>max wait (sec)</span>
                                  <input
                                    className={styles.input}
                                    type="number"
                                    min={1}
                                    value={editState.maxWaitSeconds}
                                    onChange={(e) => setEditState((s) => s ? { ...s, maxWaitSeconds: Math.max(1, Number(e.target.value) || 300) } : s)}
                                    disabled={saving}
                                  />
                                </label>
                                <label className={styles.field}>
                                  <span className={styles.fieldLabel}>PIN retries</span>
                                  <input
                                    className={styles.input}
                                    type="number"
                                    min={1}
                                    value={editState.pinRetryAttempts}
                                    onChange={(e) => setEditState((s) => s ? { ...s, pinRetryAttempts: Math.max(1, Number(e.target.value) || 3) } : s)}
                                    disabled={saving}
                                  />
                                </label>
                              </div>
                              <div className={styles.formRow}>
                                <label className={styles.field}>
                                  <span className={styles.fieldLabel}>wait audio</span>
                                  <SearchableSelect
                                    options={audioOptions}
                                    value={editState.waitAudioFileId ? String(editState.waitAudioFileId) : null}
                                    onChange={(val) => setEditState((s) => s ? { ...s, waitAudioFileId: val ? Number(val) : null } : s)}
                                    placeholder="select audio file…"
                                  />
                                  {editState.waitAudioFileId ? (
                                    (() => {
                                      const item = audioItems.find(a => a.id === editState.waitAudioFileId);
                                      const srcPath = item?.previewUrl || item?.originalUrl;
                                      return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={editState.waitAudioFileId} src={`${BASE}${srcPath}`} /> : null;
                                    })()
                                  ) : null}
                                </label>
                                <label className={styles.field}>
                                  <span className={styles.fieldLabel}>operators</span>
                                  <OperatorPickerRow
                                    allOperators={operators}
                                    selectedIds={editState.operatorIds}
                                    onChange={(ids) => setEditState((s) => s ? { ...s, operatorIds: ids } : s)}
                                  />
                                </label>
                              </div>
                              <div className={styles.formActions}>
                                <button className={styles.cancelButton} type="button" onClick={cancelEdit} disabled={saving}>cancel</button>
                                <button className={styles.primaryButton} type="submit" disabled={saving}>
                                  {saving ? 'saving…' : 'save'}
                                </button>
                              </div>
                            </div>
                          </form>
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
          {!createOpen && errorText && editState === null ? <ErrorMessage message={errorText} /> : null}
        </div>

      </div>
  );
}
