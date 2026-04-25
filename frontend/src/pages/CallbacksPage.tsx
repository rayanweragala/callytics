import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { cancelCallback, executeCallback, listCallbacks } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { CallbackItem } from '../types';
import styles from './CallbacksPage.module.css';

const PAGE_LIMIT = 20;
const ACTIVE_STATUSES = new Set<CallbackItem['status']>([
  'pending',
  'dialing_operator',
  'dialing_customer',
  'bridged',
]);

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
  const [items, setItems] = useState<CallbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [executeStateById, setExecuteStateById] = useState<Record<number, ExecuteState>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

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
    setRowErrors((current) => ({ ...current, [id]: '' }));
    try {
      await cancelCallback(id);
      setConfirmCancelId(null);
      await load(page);
    } catch (error) {
      setRowErrors((current) => ({ ...current, [id]: getApiError(error, 'failed to cancel callback') }));
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageLayout title="Callbacks" subtitle="configure" />
      </div>
        <div className={styles.tableCard}>
          <div className={styles.filters}>
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>status</span>
              <select
                className={styles.select}
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="dialing">Dialing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>

          {loading ? <Loading message="Loading callbacks..." /> : null}
          {!loading && items.length === 0 ? <div className={styles.emptyState}>No callbacks found.</div> : null}

          {!loading ? (
            <table>
              <colgroup>
                <col className={styles.colId} />
                <col className={styles.colCustomer} />
                <col className={styles.colOperator} />
                <col className={styles.colStatus} />
                <col className={styles.colReceived} />
                <col className={styles.colExecuted} />
                <col className={styles.colActions} />
              </colgroup>
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
                {items.map((item) => (
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
                        confirmCancelId === item.id ? (
                          <div className={styles.confirmInline}>
                            <span>Cancel callback?</span>
                            <button className={styles.dangerButton} type="button" onClick={() => void handleCancel(item.id)}>Confirm</button>
                            <button className={styles.secondaryButton} type="button" onClick={() => setConfirmCancelId(null)}>No</button>
                          </div>
                        ) : (
                          <div className={styles.actions}>
                            <button
                              className={styles.primaryButton}
                              type="button"
                              onClick={() => void handleExecute(item.id)}
                              disabled={executeStateById[item.id] === 'loading'}
                            >
                              {executeStateById[item.id] === 'loading' ? 'calling…' : executeStateById[item.id] === 'saved' ? 'done ✓' : 'Call Now'}
                            </button>
                            <button className={styles.dangerButton} type="button" onClick={() => setConfirmCancelId(item.id)}>Cancel</button>
                          </div>
                        )
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

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          <ErrorMessage message={errorText} />
        </div>
      </div>
  );
}
