import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pagination } from '../components/common/Pagination';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { PageLayout } from '../components/common/PageLayout';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import { deleteFlow, listFlows } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { useToast } from '../context/ToastContext';
import type { FlowSummary } from '../types';
import styles from './FlowsPage.module.css';

export function FlowsPage() {
  const windowWidth = useWindowWidth();
  const { showToast } = useToast();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [failedDeleteId, setFailedDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSuccess = (id: number | null) => {
    setDeletedId(id);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (id !== null) successTimerRef.current = setTimeout(() => setDeletedId(null), 6000);
  };

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const navigate = useNavigate();

  const loadFlows = async (nextPage = page, nextLimit = limit) => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await listFlows(nextPage, nextLimit);
      setFlows(response.data);
      setPage(response.page);
      setLimit(response.limit);
      setTotalPages(response.totalPages);
    } catch (error) {
      setLoadError(getApiError(error, 'failed to load flows'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFlows(page, limit);
  }, [page, limit]);

  const handleCreate = async () => {
    navigate('/flows/new');
  };

  const confirmDelete = async (id: number) => {
    setBusyId(id);
    try {
      await deleteFlow(id);
      showSuccess(id);
      setConfirmId(null);
      void loadFlows(page, limit);
    } catch (error) {
      showToast(getApiError(error, 'failed to delete flow'), 'error');
      setFailedDeleteId(id);
      setConfirmId(null);
      window.setTimeout(() => {
        setFailedDeleteId((current) => (current === id ? null : current));
      }, 6000);
    } finally {
      setBusyId(null);
    }
  };

  const blockingLoadError = !loading ? loadError : null;

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="flow builder" subtitle="configure" />
        <button className={`${styles.primaryButton} btn-press`} onClick={() => void handleCreate()} type="button">
          new flow
        </button>
      </div>
      {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
      {!blockingLoadError ? (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>name</th>
                <th>created</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className={styles.emptyState}>—</td></tr>
              ) : flows.length === 0 ? (
                <tr><td colSpan={3} className={styles.emptyState}>No flows yet.</td></tr>
              ) : (
                flows.map((flow) => (
                  <tr key={flow.id} className="table-row-hover">
                    <td>
                      <div className={styles.flowName}>{flow.name}</div>
                      <div className={styles.flowDescription}>{flow.description || '—'}</div>
                    </td>
                    <td className={styles.createdAt} title={flow.createdAt}>{formatDateTime(flow.createdAt)}</td>
                    <td>
                      <div className={styles.actions}>
                        {deletedId === flow.id ? (
                          <div className={styles.deletedText}>deleted</div>
                        ) : (
                          <>
                            <button className={`${styles.secondaryButton} ${styles.editButton}`} onClick={() => navigate(`/flows/${flow.id}`)} type="button">edit</button>
                            <button className={`${styles.secondaryButton} ${styles.deleteButton}`} onClick={() => setConfirmId(flow.id)} type="button">delete</button>
                            {failedDeleteId === flow.id ? <div className={styles.failedText}>failed to delete</div> : null}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmId !== null}
        title="Delete flow"
        message="Delete this flow? This cannot be undone."
        cancelLabel="cancel"
        confirmLabel={busyId !== null ? 'deleting…' : 'delete'}
        isLoading={busyId !== null}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId !== null) {
            void confirmDelete(confirmId);
          }
        }}
      />
    </div>
  );
}
