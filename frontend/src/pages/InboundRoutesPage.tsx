import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { createInboundRoute, deleteInboundRoute, listFlows, listInboundRoutes, updateInboundRoute } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { FlowSummary, InboundRouteItem } from '../types';
import styles from './InboundRoutesPage.module.css';

interface RouteFormState {
  did: string;
  label: string;
  flowId: string;
}

const emptyForm: RouteFormState = {
  did: '',
  label: '',
  flowId: '',
};
const INBOUND_EXTENSION_CONFLICT_MESSAGE = 'This number is already in use as an extension. Choose a different DID.';

export function InboundRoutesPage() {
  const [items, setItems] = useState<InboundRouteItem[]>([]);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<RouteFormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<RouteFormState>(emptyForm);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createDidError, setCreateDidError] = useState<string | null>(null);
  const [editDidError, setEditDidError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editPanelRef = useRef<HTMLDivElement | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const showError = (msg: string | null) => {
    setErrorText(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) errorTimerRef.current = setTimeout(() => setErrorText(null), 6000);
  };

  const showSuccess = (id: number | null) => {
    setDeletedId(id);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (id !== null) successTimerRef.current = setTimeout(() => setDeletedId(null), 6000);
  };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.did.localeCompare(b.did)), [items]);
  const flowOptions = flows.map((f) => ({ value: String(f.id), label: f.name }));

  const load = async (nextLimit = limit, nextOffset = offset) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [routesResponse, flowsResponse] = await Promise.all([
        listInboundRoutes(undefined, nextLimit, nextOffset),
        listFlows(1, 100),
      ]);
      setItems(routesResponse.data);
      setTotal(routesResponse.total);
      setFlows(flowsResponse.data);
    } catch {
      setLoadError('Failed to load inbound routes');
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  };

  useEffect(() => {
    void load(limit, offset);
  }, [limit, offset]);

  useEffect(() => () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const resetMessages = () => {
    showError(null);
    showSuccess(null);
    setCreateDidError(null);
    setEditDidError(null);
  };

  const applyDidConflictError = (error: unknown, mode: 'create' | 'edit'): boolean => {
    const message = getApiError(error, mode === 'create' ? 'failed to create route' : 'failed to update route');
    if (message !== INBOUND_EXTENSION_CONFLICT_MESSAGE) {
      return false;
    }
    if (mode === 'create') {
      setCreateDidError(message);
    } else {
      setEditDidError(message);
    }
    return true;
  };

  const handleCreate = async () => {
    setBusyKey('create');
    resetMessages();
    try {
      await createInboundRoute({
        did: createForm.did.trim(),
        label: createForm.label.trim() || undefined,
        flowId: Number(createForm.flowId),
      });
      setCreateForm(emptyForm);
      setCreateOpen(false);
      setOffset(0);
      await load(limit, 0);
    } catch (error) {
      if (!applyDidConflictError(error, 'create')) {
        showError(getApiError(error, 'failed to create route'));
      }
    } finally {
      setBusyKey(null);
    }
  };

  const openEdit = (item: InboundRouteItem) => {
    resetMessages();
    setCreateOpen(false);
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditForm({
      did: item.did,
      label: item.label || '',
      flowId: String(item.flowId),
    });
  };

  const closeEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
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

  const handleUpdate = async () => {
    if (editingId === null) return;
    setBusyKey(`edit-${editingId}`);
    resetMessages();
    try {
      await updateInboundRoute(editingId, {
        did: editForm.did.trim(),
        label: editForm.label.trim() || undefined,
        flowId: Number(editForm.flowId),
      });
      setEditingId(null);
      setEditForm(emptyForm);
      await load(limit, offset);
    } catch (error) {
      if (!applyDidConflictError(error, 'edit')) {
        showError(getApiError(error, 'failed to update route'));
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyKey(`delete-${id}`);
    resetMessages();
    try {
      await deleteInboundRoute(id);
      setConfirmDeleteId(null);
      showSuccess(id);
      if (editingId === id) {
        setEditingId(null);
      }
      const nextOffset = total - 1 <= offset && offset > 0 ? Math.max(0, offset - limit) : offset;
      setOffset(nextOffset);
      await load(limit, nextOffset);
    } catch (error) {
      showError(getApiError(error, 'failed to delete route'));
    } finally {
      setBusyKey(null);
    }
  };

  const pageActions = (
    <button
      className={styles.primaryButton}
      onClick={() => {
        resetMessages();
        setEditingId(null);
        setCreateOpen((current) => !current);
      }}
      type="button"
    >
      {createOpen ? 'cancel' : 'add route'}
    </button>
  );

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageLayout title="Inbound Routes" subtitle="configure" />
        {pageActions}
      </div>
      {createOpen ? (
        <section className={styles.formPanel}>
          <div className={styles.panelTitle}>new route</div>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>did</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.did} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, did: event.target.value }));
              }} />
              {createDidError ? <span className={styles.inlineFieldError}>{createDidError}</span> : null}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>label</span>
              <input className={styles.input} value={createForm.label} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, label: event.target.value }));
              }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>flow</span>
              <SearchableSelect options={flowOptions} placeholder="select flow" value={createForm.flowId || null} onChange={(value) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, flowId: value || '' }));
              }} />
            </label>
            <div className={styles.formActions}>
              <button className={styles.primaryButton} disabled={!createForm.flowId} type="button" onClick={() => void handleCreate()}>{busyKey === 'create' ? 'saving…' : 'save route'}</button>
            </div>
          </div>
          {errorText ? <ErrorMessage message={errorText} /> : null}
        </section>
      ) : null}

      <div className={styles.tableCard}>
        {isLoading ? (
          <>
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonRow key={i} columns={[
                { width: '160px' },
                { width: '180px' },
                { width: '180px' },
                { width: '108px' },
                { width: '220px' },
              ]} />
            ))}
          </>
        ) : loadError ? (
          <ErrorMessage message={loadError} />
        ) : sortedItems.length === 0 ? (
          <div className={styles.emptyState}>No inbound routes yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>did</th>
                <th>label</th>
                <th>flow</th>
                <th>created</th>
                <th className={styles.actionsHeader}>actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <Fragment key={item.id}>
                  <tr>
                    <td className={styles.dataMono}>{item.did}</td>
                    <td className={styles.labelText}>{item.label || '—'}</td>
                    <td className={styles.flowText}>{item.flowName || `flow ${item.flowId}`}</td>
                    <td className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</td>
                    <td>
                      <div className={styles.actions}>
                        <>
                          <button className={`${styles.secondaryButton} ${styles.editButton}`} onClick={() => openEdit(item)} type="button">edit</button>
                          <button className={`${styles.secondaryButton} ${styles.deleteButton}`} onClick={() => setConfirmDeleteId(item.id)} type="button">delete</button>
                        </>
                      </div>
                    </td>
                  </tr>
                  {editingId === item.id ? (
                    <tr>
                      <td colSpan={5}>
                        <div className={styles.editorRow} ref={editPanelRef}>
                          <div className={styles.editPanelHeader}>
                            <span className={styles.panelTitle}>edit route</span>
                            <button className={styles.panelCloseButton} onClick={closeEdit} type="button" aria-label="Close edit panel">×</button>
                          </div>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>did</span>
                            <input className={`${styles.input} ${styles.dataMono}`} value={editForm.did} onChange={(event) => {
                              resetMessages();
                              setEditForm((current) => ({ ...current, did: event.target.value }));
                            }} />
                            {editDidError ? <span className={styles.inlineFieldError}>{editDidError}</span> : null}
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>label</span>
                            <input className={styles.input} value={editForm.label} onChange={(event) => {
                              resetMessages();
                              setEditForm((current) => ({ ...current, label: event.target.value }));
                            }} />
                          </label>
                          <label className={`${styles.field} ${styles.editFieldFullSpan}`}>
                            <span className={styles.fieldLabel}>flow</span>
                            <SearchableSelect options={flowOptions} placeholder="select flow" value={editForm.flowId || null} onChange={(value) => {
                              resetMessages();
                              setEditForm((current) => ({ ...current, flowId: value || '' }));
                            }} />
                          </label>
                          <div className={styles.formActions}>
                            <button className={styles.secondaryButton} onClick={closeEdit} type="button">cancel</button>
                            <button className={styles.primaryButton} disabled={!editForm.flowId} type="button" onClick={() => void handleUpdate()}>{busyKey === `edit-${item.id}` ? 'saving…' : 'save changes'}</button>
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
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={(nextPage) => setOffset((nextPage - 1) * limit)}
        />
        {deletedId !== null ? <div className={styles.successText}>route deleted</div> : null}
        {errorText ? <ErrorMessage message={errorText} /> : null}
      </div>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete route"
        message="Delete this route? This cannot be undone."
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
