import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
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
  const [isLoading, setIsLoading] = useState(false);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const flowOptions = useMemo(() => flows.map((flow) => ({ value: String(flow.id), label: flow.name })), [flows]);

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
      setLoadError('Failed to load routes');
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
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
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
      showError(getApiError(error, 'failed to create route'));
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

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
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
      showError(getApiError(error, 'failed to update route'));
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

  return (
    <PageLayout title="Inbound routes" subtitle="Map DIDs to call flows">
      <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.sectionLabel}>configure</div>
          <h1 className={styles.title}>inbound routing</h1>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => {
            resetMessages();
            setEditingId(null);
            setCreateOpen((current) => !current);
          }}
          type="button"
        >
          {createOpen ? 'cancel' : '+ add route'}
        </button>
      </div>

      {createOpen ? (
        <section className={styles.formPanel}>
          <div className={styles.panelTitle}>new route</div>
          <form className={styles.formGrid} onSubmit={(event) => void handleCreate(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>did</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.did} onChange={(event) => {
                resetMessages();
                setCreateForm((current) => ({ ...current, did: event.target.value }));
              }} />
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
              <button className={styles.primaryButton} disabled={!createForm.flowId} type="submit">{busyKey === 'create' ? 'saving…' : 'save route'}</button>
            </div>
          </form>
          {errorText ? <ErrorMessage message={errorText} /> : null}
        </section>
      ) : (
        <section className={styles.tablePanel}>
          <div className={styles.tableHead}>
            <div>did</div>
            <div>label</div>
            <div>flow</div>
            <div>created</div>
            <div className={styles.actionsHeader}>actions</div>
          </div>
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
            <div className={styles.empty}>No inbound routes yet.</div>
          ) : (
            <div className="fadeIn">
              {sortedItems.map((item) => (
                <Fragment key={item.id}>
                  <div className={styles.row}>
                <div className={styles.dataMono}>{item.did}</div>
                <div className={styles.labelText}>{item.label || '—'}</div>
                <div className={styles.flowText}>{item.flowName || `flow ${item.flowId}`}</div>
                <div className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</div>
                <div className={styles.actions}>
                  {confirmDeleteId === item.id ? (
                    <div className={styles.confirmBox}>
                      <div className={styles.confirmText}>Delete this route? This cannot be undone.</div>
                      <div className={styles.confirmActions}>
                        <button className={styles.secondaryButton} onClick={() => setConfirmDeleteId(null)} type="button">cancel</button>
                        <button className={styles.deleteButton} onClick={() => void handleDelete(item.id)} type="button">
                          {busyKey === `delete-${item.id}` ? 'deleting…' : 'delete'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className={styles.secondaryButton} onClick={() => openEdit(item)} type="button">edit</button>
                      <button className={styles.secondaryButton} onClick={() => setConfirmDeleteId(item.id)} type="button">delete</button>
                    </>
                  )}
                </div>
              </div>
              {editingId === item.id ? (
                <form className={styles.editorRow} onSubmit={(event) => void handleUpdate(event)}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>did</span>
                    <input className={`${styles.input} ${styles.dataMono}`} value={editForm.did} onChange={(event) => {
                      resetMessages();
                      setEditForm((current) => ({ ...current, did: event.target.value }));
                    }} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>label</span>
                    <input className={styles.input} value={editForm.label} onChange={(event) => {
                      resetMessages();
                      setEditForm((current) => ({ ...current, label: event.target.value }));
                    }} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>flow</span>
                    <SearchableSelect options={flowOptions} placeholder="select flow" value={editForm.flowId || null} onChange={(value) => {
                      resetMessages();
                      setEditForm((current) => ({ ...current, flowId: value || '' }));
                    }} />
                  </label>
                  <div className={styles.formActions}>
                    <button className={styles.secondaryButton} onClick={() => setEditingId(null)} type="button">cancel</button>
                    <button className={styles.primaryButton} disabled={!editForm.flowId} type="submit">{busyKey === `edit-${item.id}` ? 'saving…' : 'save changes'}</button>
                  </div>
                </form>
              ) : null}
            </Fragment>
          ))}
          </div>
          )}
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setOffset((nextPage - 1) * limit)}
          />
          {deletedId !== null ? <div className={styles.successText}>route deleted</div> : null}
          {errorText ? <ErrorMessage message={errorText} /> : null}
        </section>
      )}
      </div>
    </PageLayout>
  );
}
