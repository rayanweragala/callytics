import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createFlow, deleteFlow, listFlows } from '../lib/api';
import { formatDate } from '../lib/time';
import type { FlowSummary } from '../types';
import styles from './FlowsPage.module.css';

export function FlowsPage() {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [failedDeleteId, setFailedDeleteId] = useState<number | null>(null);
  const navigate = useNavigate();

  const loadFlows = async () => {
    setLoading(true);
    try {
      const response = await listFlows();
      setFlows(response.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFlows();
  }, []);

  const handleCreate = async () => {
    setBusyId(-1);
    try {
      const response = await createFlow({
        name: 'Untitled Flow',
        description: 'New flow',
        nodes: [
          {
            nodeKey: 'start',
            type: 'start',
            label: 'Start',
            positionX: 80,
            positionY: 140,
            config: {},
          },
        ],
        edges: [],
      });
      navigate(`/flows/${response.data.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (id: number) => {
    setBusyId(id);
    try {
      await deleteFlow(id);
      setDeletedId(id);
      setConfirmId(null);
      window.setTimeout(() => {
        setFlows((current) => current.filter((flow) => flow.id !== id));
        setDeletedId((current) => (current === id ? null : current));
      }, 1200);
    } catch {
      setFailedDeleteId(id);
      setConfirmId(null);
      window.setTimeout(() => {
        setFailedDeleteId((current) => (current === id ? null : current));
      }, 2000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.sectionLabel}>configure</div>
          <h1 className={styles.title}>flow builder</h1>
        </div>
        <button className={styles.primaryButton} onClick={() => void handleCreate()} type="button">
          {busyId === -1 ? 'creating…' : 'new flow'}
        </button>
      </div>

      <div className={styles.tableCard}>
        <div className={styles.tableHead}>
          <div>name</div>
          <div>created</div>
          <div>actions</div>
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
              <div className={styles.createdAt} title={flow.createdAt}>{formatDate(flow.createdAt)}</div>
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
      </div>
    </div>
  );
}
