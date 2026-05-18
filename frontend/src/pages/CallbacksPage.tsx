import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { cancelCallback, executeCallback, listCallbacks } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import type { CallbackItem } from '../types';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import styles from './CallbacksPage.module.css';

const PAGE_LIMIT = 10;
const ACTIVE_STATUSES = new Set<CallbackItem['status']>([
  'pending',
  'dialing_operator',
  'dialing_customer',
  'bridged',
]);
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

type ExecuteState = 'idle' | 'loading' | 'saved';

function statusClass(status: CallbackItem['status']): string {
  if (status === 'pending') return styles.statusPending;
  if (status === 'dialing_operator' || status === 'dialing_customer' || status === 'bridged') return styles.statusDialing;
  if (status === 'completed') return styles.statusCompleted;
  if (status === 'failed') return styles.statusFailed;
  return styles.statusCancelled;
}

function statusLabel(status: CallbackItem['status']): string {
  if (status === 'dialing_operator') return 'dialing operator';
  if (status === 'dialing_customer') return 'dialing customer';
  return status;
}

function resolveOperatorDisplay(item: CallbackItem): { value: string | null; mono: boolean } {
  if (item.destinationType === 'pstn') {
    return { value: item.destinationValue || null, mono: true };
  }
  if (item.destinationType === 'extension') {
    return { value: item.operatorName || item.destinationValue || null, mono: false };
  }
  return { value: item.operatorName || null, mono: false };
}

export function CallbacksPage() {
  const windowWidth = useWindowWidth();
  const [items, setItems] = useState<CallbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [executeStateById, setExecuteStateById] = useState<Record<number, ExecuteState>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const pollRef = useRef<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const showPagination = total > 0;

  const load = useCallback(async (nextPage = page) => {
    const response = await listCallbacks({
      page: nextPage,
      limit: PAGE_LIMIT,
      status: statusFilter || undefined,
    });
    setItems(response.data);
    setTotal(response.total);
  }, [page, statusFilter]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErrorText(null);
    load(page)
      .catch((error) => {
        if (!active) return;
        setErrorText(getApiError(error, 'failed to load callbacks'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [load, page]);

  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    const hasActive = items.some((item) => ACTIVE_STATUSES.has(item.status));
    if (!hasActive) {
      return;
    }

    pollRef.current = window.setInterval(() => {
      void load(page).catch(() => undefined);
    }, 5000);

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [items, load, page]);

  const handleExecute = async (id: number) => {
    setRowErrors((current) => ({ ...current, [id]: '' }));
    setExecuteStateById((current) => ({ ...current, [id]: 'loading' }));
    try {
      await executeCallback(id);
      setExecuteStateById((current) => ({ ...current, [id]: 'saved' }));
      window.setTimeout(() => {
        setExecuteStateById((current) => ({ ...current, [id]: 'idle' }));
      }, 1500);
      await load(page);
    } catch (error) {
      setExecuteStateById((current) => ({ ...current, [id]: 'idle' }));
      setRowErrors((current) => ({ ...current, [id]: getApiError(error, 'failed to execute callback') }));
    }
  };

  const handleCancel = async (id: number) => {
    setIsCancelling(true);
    setRowErrors((current) => ({ ...current, [id]: '' }));
    try {
      await cancelCallback(id);
      setConfirmCancelId(null);
      await load(page);
    } catch (error) {
      setRowErrors((current) => ({ ...current, [id]: getApiError(error, 'failed to cancel callback') }));
    } finally {
      setIsCancelling(false);
    }
  };

  const blockingLoadError = !loading ? errorText : null;

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="Callbacks" subtitle="configure" />
      </div>
      {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
      {!blockingLoadError ? (
        <>

      <div className={styles.filters}>
        <div className={styles.filterPills} role="tablist" aria-label="Callback status filter">
          {STATUS_OPTIONS.map((option) => {
            const active = statusFilter === option.value;
            return (
              <button
                key={option.value || 'all'}
                className={`${styles.filterPill} ${active ? styles.filterPillActive : ''}`}
                onClick={() => {
                  setStatusFilter(option.value);
                  setPage(1);
                }}
                role="tab"
                aria-selected={active}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.tableCard}>
        {loading ? <Loading message="Loading callbacks..." /> : null}
        {!loading ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Customer Number</th>
                <th>Operator</th>
                <th className={styles.statusHeader}>Status</th>
                <th>Received</th>
                <th>Executed</th>
                <th className={styles.actionsHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyState}>No callbacks found.</td>
                </tr>
              ) : items.map((item) => (
                (() => {
                  const operatorDisplay = resolveOperatorDisplay(item);
                  return (
                    <tr key={item.id} className={styles.row}>
                      <td className={styles.dataMono}>{item.id}</td>
                      <td className={styles.dataMono}>{item.customerNumber || <span className={styles.dashMuted}>—</span>}</td>
                      <td className={operatorDisplay.mono ? styles.dataMono : undefined}>
                        {operatorDisplay.value || <span className={styles.dashMuted}>—</span>}
                      </td>
                      <td className={styles.statusCell}>
                        <span className={`${styles.statusBadge} ${statusClass(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td className={styles.dataMono}>{item.createdAt ? formatDateTime(item.createdAt) : <span className={styles.dashMuted}>—</span>}</td>
                      <td className={styles.dataMono}>{item.executedAt ? formatDateTime(item.executedAt) : <span className={styles.dashMuted}>—</span>}</td>
                      <td className={styles.actionsCell}>
                        {item.status === 'pending' ? (
                          <div className={styles.actions}>
                            <button
                              className={`${styles.secondaryButton} ${styles.actionButton}`}
                              type="button"
                              onClick={() => void handleExecute(item.id)}
                              disabled={executeStateById[item.id] === 'loading'}
                            >
                              {executeStateById[item.id] === 'loading' ? 'calling…' : executeStateById[item.id] === 'saved' ? 'done ✓' : 'Call Now'}
                            </button>
                            <button className={`${styles.secondaryButton} ${styles.actionButton}`} type="button" onClick={() => setConfirmCancelId(item.id)}>Cancel</button>
                          </div>
                        ) : (
                          null
                        )}
                      </td>
                    </tr>
                  );
                })()
              ))}
            </tbody>
          </table>
        ) : null}

        {!loading && items.map((item) => (
          rowErrors[item.id] ? (
            <div key={`err-${item.id}`} className={styles.rowError}>{rowErrors[item.id]}</div>
          ) : null
        ))}

        {showPagination ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}
      </div>
        </>
      ) : null}
      <ConfirmDialog
        open={confirmCancelId !== null}
        title="Cancel callback"
        message="Cancel callback?"
        cancelLabel="no"
        confirmLabel={isCancelling ? 'cancelling…' : 'confirm'}
        isLoading={isCancelling}
        onCancel={() => setConfirmCancelId(null)}
        onConfirm={() => {
          if (confirmCancelId !== null) {
            void handleCancel(confirmCancelId);
          }
        }}
      />
    </div>
  );
}
