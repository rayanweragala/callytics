import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import {
  getCampaign,
  getCampaignProgress,
  listCampaignContactAttempts,
  listCampaignContacts,
  stopCampaign,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { CampaignContactAttemptItem, CampaignContactItem, CampaignItem } from '../types';
import styles from './CampaignDetailPage.module.css';

const PAGE_SIZE = 50;

const STATUS_FILTERS = ['all', 'pending', 'dialing', 'answered', 'failed', 'no_answer', 'busy'] as const;

function campaignStatusLabel(status: CampaignItem['status']): string {
  if (status === 'cancelling') return 'cancelling...';
  return status;
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const campaignId = Number(id || 0);
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<CampaignItem | null>(null);
  const [contacts, setContacts] = useState<CampaignContactItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [attemptsByContact, setAttemptsByContact] = useState<Record<number, CampaignContactAttemptItem[]>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [progress, setProgress] = useState<{
    status: string;
    totalContacts: number;
    dialedCount: number;
    answeredCount: number;
    failedCount: number;
    pendingCount: number;
    activeCallCount: number;
  } | null>(null);
  const [confirmStopInline, setConfirmStopInline] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const effectiveProgress = progress || {
    status: campaign?.status || 'draft',
    totalContacts: campaign?.totalContacts || 0,
    dialedCount: campaign?.dialedCount || 0,
    answeredCount: campaign?.answeredCount || 0,
    failedCount: campaign?.failedCount || 0,
    pendingCount: Math.max(0, (campaign?.totalContacts || 0) - (campaign?.dialedCount || 0)),
    activeCallCount: 0,
  };

  const progressPercent = effectiveProgress.totalContacts > 0
    ? Math.round((effectiveProgress.answeredCount / effectiveProgress.totalContacts) * 100)
    : 0;

  const loadCampaign = async () => {
    const response = await getCampaign(campaignId);
    setCampaign(response);
  };

  const loadContacts = async () => {
    setLoading(true);
    setErrorText(null);
    try {
      const response = await listCampaignContacts(campaignId, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setContacts(response.contacts);
      setTotal(response.total);
    } catch (error) {
      setErrorText(getApiError(error, 'failed to load contacts'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!campaignId) return;
    void loadCampaign().catch((error) => setErrorText(getApiError(error, 'failed to load campaign')));
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    void loadContacts();
  }, [campaignId, page, statusFilter]);

  useEffect(() => {
    if (campaign?.status !== 'running') {
      setProgress(null);
      return;
    }

    const tick = async () => {
      try {
        const current = await getCampaignProgress(campaignId);
        setProgress(current);
      } catch {
        // ignore polling failures
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [campaign?.status, campaignId]);

  const toggleHistory = async (contact: CampaignContactItem) => {
    const isOpen = !!expanded[contact.id];
    setExpanded((current) => ({ ...current, [contact.id]: !isOpen }));
    if (!isOpen && !attemptsByContact[contact.id]) {
      const attempts = await listCampaignContactAttempts(campaignId, contact.id);
      setAttemptsByContact((current) => ({ ...current, [contact.id]: attempts }));
    }
  };

  const blockingLoadError = !loading ? errorText : null;

  const pending = useMemo(
    () => Math.max(0, effectiveProgress.totalContacts - (effectiveProgress.answeredCount + effectiveProgress.failedCount)),
    [effectiveProgress],
  );

  if (blockingLoadError) {
    return (
      <PageLayout title={campaign?.name || 'campaign'} subtitle="outbound">
        <ErrorMessage message={blockingLoadError} />
      </PageLayout>
    );
  }

  return (
    <PageLayout title={campaign?.name || 'campaign'} subtitle="outbound">
      <div className={styles.page}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <button className={styles.secondaryButton} type="button" onClick={() => navigate('/campaigns')}>
              back
            </button>
          </div>
        </div>

        <section className={styles.summaryCard}>
          {!campaign ? <Loading message="Loading campaign..." /> : (
            <>
              <div className={styles.summaryTop}>
                <div className={styles.campaignStatusBadge}>{campaignStatusLabel(campaign.status)}</div>
                {campaign.status === 'running' ? (
                  <button className={styles.stopButton} type="button" onClick={() => setConfirmStopInline(true)}>stop campaign</button>
                ) : null}
              </div>

              <div className={styles.summaryGrid}>
                <div><span>scheduled</span><strong>{campaign.scheduledAt ? formatDateTime(campaign.scheduledAt) : '—'}</strong></div>
                <div><span>flow</span><strong>{campaign.flowName || '—'}</strong></div>
                <div><span>trunk</span><strong>{campaign.trunkName || '—'}</strong></div>
                <div><span>max concurrent</span><strong>{campaign.maxConcurrent}</strong></div>
                <div><span>max retries</span><strong>{campaign.maxRetries}</strong></div>
                <div><span>active calls</span><strong>{effectiveProgress.activeCallCount}</strong></div>
              </div>

              <div className={styles.statsRow}>
                <span>total {effectiveProgress.totalContacts}</span>
                <span>dialed {effectiveProgress.dialedCount}</span>
                <span>answered {effectiveProgress.answeredCount}</span>
                <span>failed {effectiveProgress.failedCount}</span>
                <span>pending {pending}</span>
              </div>

              {(campaign.status === 'running' || campaign.status === 'completed') ? (
                <div className={styles.progressRow}>
                  <span className={styles.mono}>{effectiveProgress.answeredCount}/{effectiveProgress.totalContacts}</span>
                  <span className={styles.progressTrack}><span className={styles.progressFill} style={{ width: `${progressPercent}%` }} /></span>
                </div>
              ) : null}
            </>
          )}
        </section>

        <div className={styles.tableCard}>
          <div className={styles.filters}>
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                className={`${styles.filterPill} ${statusFilter === status ? styles.filterPillActive : ''}`}
                type="button"
                onClick={() => {
                  setPage(1);
                  setStatusFilter(status);
                }}
              >
                {status === 'all' ? 'All' : status.replace('_', ' ')}
              </button>
            ))}
          </div>

          {loading ? <Loading message="Loading contacts..." /> : null}
          {!loading && contacts.length === 0 ? <div className={styles.emptyState}>No contacts in this campaign.</div> : null}

          {!loading && contacts.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Phone Number</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last Attempt</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <Fragment key={contact.id}>
                    <tr>
                      <td className={styles.mono}>{contact.phoneNumber}</td>
                      <td>{contact.name || '—'}</td>
                      <td><span className={styles.statusBadge}>{contact.status}</span></td>
                      <td className={styles.mono}>{contact.attempts}</td>
                      <td className={styles.mono}>{contact.lastAttemptAt ? formatDateTime(contact.lastAttemptAt) : '—'}</td>
                      <td>
                        <button className={styles.historyButton} type="button" onClick={() => void toggleHistory(contact)}>history</button>
                      </td>
                    </tr>
                    {expanded[contact.id] ? (
                      <tr>
                        <td colSpan={6}>
                          <div className={styles.historyPanel}>
                            {(attemptsByContact[contact.id] || []).map((attempt) => (
                              <div className={styles.historyRow} key={attempt.id}>
                                <span>Attempt #{attempt.attemptNumber}</span>
                                <span>{attempt.outcome}</span>
                                <span>{attempt.duration === null ? '—' : `${attempt.duration}s`}</span>
                                <span>{attempt.startedAt ? formatDateTime(attempt.startedAt) : '—'}</span>
                                <span>
                                  {attempt.callLogId ? (
                                    <button className={styles.historyButton} type="button" onClick={() => navigate(`/call-logs?callLogId=${attempt.callLogId}`)}>{`>`}</button>
                                  ) : '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          <ErrorMessage message={errorText} />
        </div>
      </div>
      <ConfirmDialog
        open={confirmStopInline}
        title="Stop campaign"
        message="Stop this campaign?"
        cancelLabel="cancel"
        confirmLabel="stop"
        onCancel={() => setConfirmStopInline(false)}
        onConfirm={() => {
          setConfirmStopInline(false);
          void stopCampaign(campaignId).then(() => loadCampaign()).catch((error) => {
            setErrorText(getApiError(error, 'failed to stop campaign'));
          });
        }}
      />
    </PageLayout>
  );
}
