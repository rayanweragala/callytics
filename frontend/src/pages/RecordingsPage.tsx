import { useRef, useEffect, useState } from 'react';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import { Pagination } from '../components/common/Pagination';
import { deleteRecording, listRecordings } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { RecordingItem } from '../types';
import styles from './RecordingsPage.module.css';

const backendBase = 'http://localhost:3001';

function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function RecordingsPage() {
  const [errorText, setErrorText] = useState<string | null>(null);
  const [items, setItems] = useState<RecordingItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
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

  const load = async (nextPage = page, nextLimit = limit) => {
    const response = await listRecordings(nextPage, nextLimit);
    if (response.totalPages > 0 && nextPage > response.totalPages) {
      await load(response.totalPages, nextLimit);
      return;
    }
    setItems(response.data);
    setPage(response.page);
    setLimit(response.limit);
    setTotalPages(response.totalPages);
  };

  useEffect(() => {
    void load(page, limit);
  }, [page, limit]);

  const confirmDelete = async (id: number) => {
    try {
      await deleteRecording(id);
      showSuccess(id);
      setConfirmId(null);
      setActiveId((current) => (current === id ? null : current));
      void load(page, limit);
    } catch (error) {
      showError(getApiError(error, 'failed to delete recording'));
      setFailedDeleteId(id);
      setConfirmId(null);
      window.setTimeout(() => setFailedDeleteId((current) => (current === id ? null : current)), 6000);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.sectionLabel}>monitor</div>
          <h1 className={styles.title}>recordings</h1>
        </div>
      </div>

      <section className={styles.libraryPanel}>
        <div className={styles.panelTitle}>recordings</div>
        <div className={styles.tableHead}>
          <div>name</div>
          <div>source</div>
          <div>duration</div>
          <div>preview</div>
          <div>created</div>
          <div className={styles.actionsHeader}>actions</div>
        </div>
        {items.length === 0 ? (
          <div className={styles.empty}>No recordings yet. Recordings appear here automatically after calls.</div>
        ) : items.map((item) => (
          <div className={styles.row} key={item.id}>
            <div>
              <div className={styles.name}>{item.callId.slice(0, 16)}</div>
              <div className={styles.meta}>{item.flowName || 'unknown flow'}</div>
            </div>
            <div className={styles.meta}>inbound</div>
            <div className={styles.duration}>{formatDuration(item.durationSeconds)}</div>
            <div className={styles.previewCell} onClick={() => setActiveId(item.id)}>
              <AudioPreviewPlayer key={item.id} src={`${backendBase}${item.streamUrl}`} isActive={activeId === null || activeId === item.id} />
            </div>
            <div className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</div>
            <div className={styles.actions}>
              {deletedId === item.id ? (
                <div className={styles.deletedText}>deleted</div>
              ) : confirmId === item.id ? (
                <div className={styles.confirmBox}>
                  <div className={styles.confirmText}>Delete this recording? This cannot be undone.</div>
                  <div className={styles.confirmActions}>
                    <button className={styles.secondaryButton} onClick={() => setConfirmId(null)} type="button">cancel</button>
                    <button className={styles.deleteButton} onClick={() => void confirmDelete(item.id)} type="button">delete</button>
                  </div>
                </div>
              ) : (
                <>
                  <a className={`${styles.secondaryButton} ${styles.downloadButton}`} href={`${backendBase}/recordings/${item.id}/download`} target="_blank" rel="noreferrer">download</a>
                  <button className={styles.secondaryButton} onClick={() => setConfirmId(item.id)} type="button">delete</button>
                  {failedDeleteId === item.id ? <div className={styles.failedText}>failed to delete</div> : null}
                </>
              )}
            </div>
          </div>
        ))}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
        {errorText ? <div className={styles.failedText}>{errorText}</div> : null}
      </section>
    </div>
  );
}
