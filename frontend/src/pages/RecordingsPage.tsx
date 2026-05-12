import { useRef, useEffect, useState } from 'react';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { deleteRecording, listRecordings } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { RecordingItem } from '../types';
import styles from './RecordingsPage.module.css';

const backendBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

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
  const [total, setTotal] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
  const showPagination = total > 0;

  const load = async (nextPage = page, nextLimit = limit) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await listRecordings(nextPage, nextLimit);
      if (response.totalPages > 0 && nextPage > response.totalPages) {
        await load(response.totalPages, nextLimit);
        return;
      }
      setItems(response.data);
      setTotal(response.total);
      setPage(response.page);
      setLimit(response.limit);
      setTotalPages(response.totalPages);
    } catch (error) {
      setLoadError(getApiError(error, 'Failed to load recordings'));
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
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
  const blockingLoadError = !isLoading && !isInitialLoad ? loadError : null;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageLayout title="Recordings" subtitle="monitor" />
      </div>
      {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
      {!blockingLoadError ? (
        <>
          <div className={styles.tableCard}>
            {isLoading ? (
              <>
                {Array.from({ length: 3 }, (_, i) => (
                  <SkeletonRow key={i} columns={[
                    { width: '20%' },
                    { width: '15%' },
                    { width: '15%' },
                    { width: '15%' },
                    { width: '20%' },
                    { width: '15%' },
                  ]} />
                ))}
              </>
            ) : (
              <table className={styles.table}>
            <thead>
              <tr>
                <th>Filename</th>
                <th>source</th>
                <th>Duration</th>
                <th>preview</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>No recordings yet. Recordings appear here automatically after calls.</td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.name}>{item.callId.slice(0, 16)}</div>
                    <div className={styles.meta}>{item.flowName || 'unknown flow'}</div>
                  </td>
                  <td className={styles.meta}>{item.recordingType || 'inbound'}</td>
                  <td className={styles.duration}>{formatDuration(item.durationSeconds)}</td>
                  <td className={styles.previewCell} onClick={() => setActiveId(item.id)}>
                    <AudioPreviewPlayer key={item.id} src={`${backendBase}${item.streamUrl}`} isActive={activeId === null || activeId === item.id} />
                  </td>
                  <td className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      {deletedId === item.id ? (
                        <div className={styles.deletedText}>deleted</div>
                      ) : (
                        <>
                          <a className={`${styles.secondaryButton} ${styles.downloadButton}`} href={`${backendBase}/recordings/${item.id}/download`} target="_blank" rel="noreferrer">download</a>
                          <button className={`${styles.secondaryButton} ${styles.deleteButton}`} onClick={() => setConfirmId(item.id)} type="button">delete</button>
                          {failedDeleteId === item.id ? <div className={styles.failedText}>failed to delete</div> : null}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
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
            {errorText ? <ErrorMessage message={errorText} /> : null}
          </div>
          <ConfirmDialog
            open={confirmId !== null}
            title="Delete recording"
            message="Delete this recording? This cannot be undone."
            cancelLabel="cancel"
            confirmLabel="delete"
            onCancel={() => setConfirmId(null)}
            onConfirm={() => {
              if (confirmId !== null) {
                void confirmDelete(confirmId);
              }
            }}
          />
        </>
      ) : null}
    </div>
  );
}
