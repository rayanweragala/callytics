import { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pagination } from '../components/common/Pagination';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { PageLayout } from '../components/common/PageLayout';
import { deleteFlow, listFlows } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { FlowSummary } from '../types';
import styles from './FlowsPage.module.css';

export function FlowsPage() {
  const [errorText, setErrorText] = useState<string | null>(null);
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [failedDeleteId, setFailedDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = (msg: string | null) => {
    setErrorText(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) errorTimerRef.current = setTimeout(() => setErrorText(null), 6000);
  };

  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSuccess = (id: number | null) => {
    setDeletedId(id);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (id !== null) successTimerRef.current = setTimeout(() => setDeletedId(null), 6000);
  };

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const [limit, setLimit] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const navigate = useNavigate();

  const loadFlows = async (nextPage = page, nextLimit = limit) => {
    setLoading(true);
    try {
      const response = await listFlows(nextPage, nextLimit);
      setFlows(response.data);
      setPage(response.page);
      setLimit(response.limit);
      setTotalPages(response.totalPages);
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
      showError(getApiError(error, 'failed to delete flow'));
      setFailedDeleteId(id);
      setConfirmId(null);
      window.setTimeout(() => {
        setFailedDeleteId((current) => (current === id ? null : current));
      }, 6000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageLayout
      title="flow builder"
      subtitle="configure"
      actions={
        <button className={styles.primaryButton} onClick={() => void handleCreate()} type="button">
          new flow
        </button>
      }
    >
      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div>name</div>
          <div>created</div>
          <div className={styles.actionsHeader}>actions</div>
        </div>
        {loading ? (
          <div className={styles.empty}>—</div>
        ) : flows.length === 0 ? (
          <div className={styles.empty}>No flows yet.</div>
        ) : (
          flows.map((flow) => (
            <div className={styles.row} key={flow.id}>
              <div>
                <div className={styles.flowName}>{flow.name}</div>
                <div className={styles.flowDescription}>{flow.description || '—'}</div>
              </div>
              <div className={styles.createdAt} title={flow.createdAt}>{formatDateTime(flow.createdAt)}</div>
              <div className={styles.actions}>
                {deletedId === flow.id ? (
                  <div className={styles.deletedText}>deleted</div>
                ) : confirmId === flow.id ? (
                  <div className={styles.confirmBox}>
                    <div className={styles.confirmText}>Delete this flow? This cannot be undone.</div>
                    <div className={styles.confirmActions}>
                      <button className={styles.secondaryButton} onClick={() => setConfirmId(null)} type="button">cancel</button>
                      <button className={styles.deleteButton} onClick={() => void confirmDelete(flow.id)} type="button">
                        {busyId === flow.id ? 'deleting…' : 'delete'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button className={styles.secondaryButton} onClick={() => navigate(`/flows/${flow.id}`)} type="button">edit</button>
                    <button className={styles.secondaryButton} onClick={() => setConfirmId(flow.id)} type="button">delete</button>
                    {failedDeleteId === flow.id ? <div className={styles.failedText}>failed to delete</div> : null}
                  </>
                )}
              </div>
            </div>
          ))
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
        <ErrorMessage message={errorText} />
      </div>
    </PageLayout>
  );
}
