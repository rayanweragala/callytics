import { Fragment, useEffect, useMemo, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { PageLayout } from '../components/common/PageLayout';
import { listWebhookDeliveries } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { WebhookDeliveryItem } from '../types';
import styles from './WebhookLogsPage.module.css';

const PAGE_LIMIT = 20;

type ResultFilter = 'all' | 'success' | 'failed';
type GroupedResult = Exclude<ResultFilter, 'all'>;

interface WebhookDeliveryGroup {
  id: string;
  callId: string | null;
  nodeId: string | null;
  flowId: number | null;
  url: string;
  attempts: WebhookDeliveryItem[];
  firstAttempt: WebhookDeliveryItem;
  finalStatus: GroupedResult;
  attemptsSummary: string;
  lastError: string | null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function getDeliveryGroupKey(item: WebhookDeliveryItem): string {
  return `${item.callId ?? '__null_call__'}::${item.nodeId ?? '__null_node__'}`;
}

function groupWebhookDeliveries(items: WebhookDeliveryItem[]): WebhookDeliveryGroup[] {
  const groups = new Map<string, WebhookDeliveryItem[]>();

  items.forEach((item) => {
    const key = getDeliveryGroupKey(item);
    const groupItems = groups.get(key);
    if (groupItems) {
      groupItems.push(item);
      return;
    }
    groups.set(key, [item]);
  });

  return Array.from(groups.entries())
    .map(([key, attempts]) => {
      const sortedAttempts = [...attempts].sort((left, right) => left.attemptNumber - right.attemptNumber);
      const firstAttempt = sortedAttempts[0];
      const successfulAttempt = sortedAttempts.find((attempt) => attempt.success);
      const finalStatus: GroupedResult = successfulAttempt ? 'success' : 'failed';
      const lastAttempt = sortedAttempts[sortedAttempts.length - 1];

      return {
        id: key,
        callId: firstAttempt.callId,
        nodeId: firstAttempt.nodeId,
        flowId: firstAttempt.flowId,
        url: firstAttempt.url,
        attempts: sortedAttempts,
        firstAttempt,
        finalStatus,
        attemptsSummary: `${successfulAttempt?.attemptNumber ?? sortedAttempts.length} / ${sortedAttempts.length}`,
        lastError: finalStatus === 'failed' ? lastAttempt.errorMessage : null,
      };
    })
    .sort((left, right) => Date.parse(right.firstAttempt.createdAt) - Date.parse(left.firstAttempt.createdAt));
}

export function WebhookLogsPage() {
  const [data, setData] = useState<WebhookDeliveryItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const fetchDeliveries = async () => {
      setLoading(true);
      setErrorText(null);
      try {
        const response = await listWebhookDeliveries({});
        if (!active) {
          return;
        }
        setData(response.data);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(getApiError(error, 'failed to load webhook deliveries'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchDeliveries();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setPage(1);
    setExpandedRowId(null);
  }, [resultFilter]);

  const groupedData = useMemo(() => groupWebhookDeliveries(data), [data]);
  const filteredGroups = useMemo(() => {
    if (resultFilter === 'all') {
      return groupedData;
    }
    return groupedData.filter((group) => group.finalStatus === resultFilter);
  }, [groupedData, resultFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_LIMIT));
  const pagedGroups = useMemo(() => {
    const startIndex = (page - 1) * PAGE_LIMIT;
    return filteredGroups.slice(startIndex, startIndex + PAGE_LIMIT);
  }, [filteredGroups, page]);
  const showPagination = filteredGroups.length > 0;

  return (
    <PageLayout subtitle="monitor" title="Webhook Logs">
      <div className={styles.page}>
        {errorText ? <ErrorMessage message={errorText} /> : null}

        <div className={styles.filterPills}>
          <button
            className={`${styles.filterPill} ${resultFilter === 'all' ? styles.filterPillActive : ''}`}
            type="button"
            onClick={() => setResultFilter('all')}
          >
            All
          </button>
          <button
            className={`${styles.filterPill} ${resultFilter === 'success' ? styles.filterPillActive : ''}`}
            type="button"
            onClick={() => setResultFilter('success')}
          >
            Success
          </button>
          <button
            className={`${styles.filterPill} ${resultFilter === 'failed' ? styles.filterPillActive : ''}`}
            type="button"
            onClick={() => setResultFilter('failed')}
          >
            Failed
          </button>
        </div>

        <div className={styles.tableCard}>
          {loading ? <div className={styles.emptyState}>Loading webhook logs...</div> : null}
          {!loading ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>FLOW</th>
                  <th>NODE</th>
                  <th>URL</th>
                  <th>ATTEMPTS</th>
                  <th>FINAL STATUS</th>
                  <th>LAST ERROR</th>
                </tr>
              </thead>
              <tbody>
                {pagedGroups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={styles.emptyState}>No webhook deliveries found.</td>
                  </tr>
                ) : pagedGroups.map((group) => {
                  const isExpanded = expandedRowId === group.id;
                  return (
                    <Fragment key={group.id}>
                      <tr
                        className={styles.logRow}
                        onClick={() => setExpandedRowId((current) => (current === group.id ? null : group.id))}
                      >
                        <td className={styles.timestamp}>{formatDateTime(group.firstAttempt.createdAt)}</td>
                        <td className={styles.mono}>{group.flowId ?? '—'}</td>
                        <td className={styles.mono} title={group.nodeId || ''}>{group.nodeId ? truncate(group.nodeId, 22) : '—'}</td>
                        <td className={styles.mono} title={group.url}>{truncate(group.url, 40)}</td>
                        <td className={styles.mono}>{group.attemptsSummary}</td>
                        <td>
                          <span className={`${styles.badge} ${group.finalStatus === 'success' ? styles.badgeSuccess : styles.badgeFailed}`}>
                            {group.finalStatus === 'success' ? 'SUCCESS' : 'FAILED'}
                          </span>
                        </td>
                        <td className={styles.errorCell} title={group.lastError || ''}>
                          {group.lastError ? truncate(group.lastError, 48) : '—'}
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className={styles.expandedRow}>
                          <td colSpan={7} className={styles.expandedCell}>
                            <div className={styles.expandedLabel}>delivery attempts</div>
                            <div className={styles.attemptList}>
                              <div className={styles.attemptHeader}>
                                <span>ATTEMPT</span>
                                <span>TIME</span>
                                <span>STATUS</span>
                                <span>RESULT</span>
                                <span>ERROR</span>
                              </div>
                              {group.attempts.map((attempt) => (
                                <div className={styles.attemptRow} key={attempt.id}>
                                  <span className={styles.mono}>{attempt.attemptNumber}</span>
                                  <span className={styles.mono}>{formatDateTime(attempt.createdAt)}</span>
                                  <span className={styles.mono}>{attempt.httpStatus ?? '—'}</span>
                                  <span>
                                    <span className={`${styles.badge} ${attempt.success ? styles.badgeSuccess : styles.badgeFailed}`}>
                                      {attempt.success ? 'SUCCESS' : 'FAILED'}
                                    </span>
                                  </span>
                                  <span className={styles.errorCell} title={attempt.errorMessage || ''}>
                                    {attempt.errorMessage ? truncate(attempt.errorMessage, 48) : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          {showPagination ? (
            <div className={styles.paginationWrap}>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          ) : null}
        </div>
      </div>
    </PageLayout>
  );
}
