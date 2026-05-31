import { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import {
  createQueue,
  deleteQueue,
  listAllAudio,
  listOperators,
  listQueues,
  updateQueue,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { getMediaBaseUrl } from '../lib/backendBaseUrl';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
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
        <div
          className={styles.operatorSelectWrap}
          style={{ ['--operator-select-gap' as string]: selectedIds.length > 0 ? '8px' : '0px' }}
        >
          <SearchableSelect
            options={unselected.map((op) => ({ value: String(op.id), label: op.name }))}
            value={null}
            placeholder="add operator"
            onChange={(value) => {
              const id = Number(value);
              if (id && !selectedIds.includes(id)) onChange([...selectedIds, id]);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function QueuesPage() {
  const windowWidth = useWindowWidth();
  const BASE = getMediaBaseUrl();
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const editPanelRef = useRef<HTMLDivElement | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const showPagination = total > 0;

  const load = useCallback(async (nextPage = page) => {
    setLoadError(null);
    const [qRes, oRes, aRes] = await Promise.allSettled([
      listQueues(nextPage, PAGE_LIMIT),
      listOperators(1, 200),
      listAllAudio(),
    ]);
    if (qRes.status === 'rejected' && oRes.status === 'rejected' && aRes.status === 'rejected') {
      setLoadError(getApiError(qRes.reason, 'Failed to load queues'));
    }
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

  const handleCreate = async () => {
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

  useEffect(() => {
    if (!editState) {
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
      cancelEdit();
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [editState]);

  const handleSave = async () => {
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
      className={`${styles.primaryButton} btn-press`}
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

  if (!loading && loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <PageLayout title="Queues" subtitle="configure" />
        </div>
        <ErrorMessage message={loadError} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="Queues" subtitle="configure" />
        {pageActions}
      </div>
      {/* Create form */}
      {createOpen ? (
        <div className={styles.formPanel}>
          <div className={styles.panelTitle}>new queue</div>
          <div>
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
                <button className={`${styles.primaryButton} btn-press`} type="button" onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? 'creating…' : 'add queue'}
                </button>
              </div>
            </div>
            {errorText ? <ErrorMessage message={errorText} /> : null}
          </div>
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
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Members</th>
                <th>max wait</th>
                <th>PIN retries</th>
                <th>created</th>
                <th className={styles.actionsHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queues.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>No queues yet.</td>
                </tr>
              ) : queues.map((q) => (
                <Fragment key={q.id}>
                  <tr className="table-row-hover">
                    <td className={styles.rowValue}>{q.name}</td>
                    <td className={styles.rowMuted}>{q.operators.map((o) => o.name).join(', ') || '—'}</td>
                    <td className={styles.dataMono}>{q.maxWaitSeconds}s</td>
                    <td className={styles.dataMono}>{q.pinRetryAttempts}</td>
                    <td className={styles.createdAt}>{formatDateTime(q.createdAt)}</td>
                    <td>
                      <div className={styles.actions}>
                        <>
                          <button
                            className={styles.editButton}
                            type="button"
                            onClick={() => startEdit(q)}
                          >
                            edit
                          </button>
                          <button
                            className={styles.deleteButton}
                            type="button"
                            onClick={() => setConfirmDeleteId(q.id)}
                          >
                            delete
                          </button>
                        </>
                      </div>
                    </td>
                  </tr>

                  {editState?.queueId === q.id ? (
                    <tr>
                      <td colSpan={6}>
                        <div className={styles.editorRow} ref={editPanelRef}>
                          <div className={styles.editPanelHeader}>
                            <span className={styles.panelTitle}>edit queue</span>
                            <button className={styles.panelCloseButton} type="button" onClick={cancelEdit} aria-label="Close edit panel">×</button>
                          </div>
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
                              <button className={`${styles.primaryButton} btn-press`} type="button" onClick={() => void handleSave()} disabled={saving}>
                                {saving ? 'saving…' : 'save'}
                              </button>
                            </div>
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
        {!createOpen && errorText && editState === null ? <ErrorMessage message={errorText} /> : null}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete queue"
        message="Delete this queue? This cannot be undone."
        cancelLabel="cancel"
        confirmLabel={confirmDeleteId !== null && deletingId === confirmDeleteId ? 'deleting…' : 'delete'}
        isLoading={deletingId !== null}
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
