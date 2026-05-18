import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import {
  createCampaign,
  deleteCampaign,
  listCampaigns,
  listFlows,
  listTrunks,
  scheduleCampaign,
  stopCampaign,
  updateCampaign,
  uploadCampaignContacts,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import type { CampaignItem, FlowSummary, SipTrunkItem } from '../types';
import styles from './CampaignsPage.module.css';

const PAGE_SIZE = 25;
type UploadState = 'idle' | 'busy' | 'saved' | 'failed';
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States (+1)' },
  { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'LK', label: 'Sri Lanka (+94)' },
  { code: 'IN', label: 'India (+91)' },
  { code: 'AU', label: 'Australia (+61)' },
  { code: 'SG', label: 'Singapore (+65)' },
  { code: 'CA', label: 'Canada (+1)' },
  { code: 'DE', label: 'Germany (+49)' },
  { code: 'FR', label: 'France (+33)' },
  { code: 'AE', label: 'UAE (+971)' },
];

function statusClass(status: CampaignItem['status']): string {
  if (status === 'draft') return styles.statusDraft;
  if (status === 'scheduled') return styles.statusScheduled;
  if (status === 'running') return styles.statusRunning;
  if (status === 'failed') return styles.statusFailed;
  return styles.statusMuted;
}

function statusLabel(status: CampaignItem['status']): string {
  if (status === 'cancelling') return 'cancelling...';
  return status;
}

export function CampaignsPage() {
  const windowWidth = useWindowWidth();
  const navigate = useNavigate();
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const editPanelRef = useRef<HTMLElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignItem | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [successText, setSuccessText] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = (msg: string) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessText(msg);
    successTimerRef.current = setTimeout(() => setSuccessText(null), 3000);
  };

  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [flowId, setFlowId] = useState<string | null>(null);
  const [trunkId, setTrunkId] = useState<string | null>(null);
  const [callerId, setCallerId] = useState('');
  const [defaultCountry, setDefaultCountry] = useState('US');
  const [scheduledAt, setScheduledAt] = useState('');
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [maxRetries, setMaxRetries] = useState(2);
  const [retryIntervalMinutes, setRetryIntervalMinutes] = useState(30);
  const [scheduledAtError, setScheduledAtError] = useState<string | null>(null);

  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [trunks, setTrunks] = useState<SipTrunkItem[]>([]);

  const [contactCount, setContactCount] = useState(0);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadSkippedReasons, setUploadSkippedReasons] = useState<string[]>([]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showPagination = total > 0;
  const formOpen = createOpen || editingCampaign !== null;
  const saveLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'failed' : editingCampaign ? 'save campaign' : 'add campaign';
  const saveButtonClass = saveState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const blockingLoadError = !loading ? loadError : null;

  const flowOptions = useMemo(
    () => flows.map((flow) => ({ value: String(flow.id), label: flow.name })),
    [flows],
  );

  const trunkOptions = useMemo(
    () => trunks.map((trunk) => ({ value: String(trunk.id), label: trunk.name })),
    [trunks],
  );

  const resetForm = () => {
    setName('');
    setFlowId(null);
    setTrunkId(null);
    setCallerId('');
    setDefaultCountry('US');
    setScheduledAt('');
    setMaxConcurrent(3);
    setMaxRetries(2);
    setRetryIntervalMinutes(30);
    setScheduledAtError(null);
    setContactCount(0);
    setUploadFile(null);
    setUploadState('idle');
    setUploadMessage(null);
    setUploadSkippedReasons([]);
  };

  const loadCampaigns = async (nextPage = page) => {
    setLoading(true);
    setErrorText(null);
    setLoadError(null);
    try {
      const offset = (nextPage - 1) * PAGE_SIZE;
      const response = await listCampaigns(PAGE_SIZE, offset);
      setCampaigns(response.campaigns);
      setTotal(response.total);
    } catch (error) {
      setLoadError(getApiError(error, 'failed to load campaigns'));
    } finally {
      setLoading(false);
    }
  };

  const loadReferences = async () => {
    const [flowResponse, trunkResponse] = await Promise.all([
      listFlows(1, 1000),
      listTrunks(1000, 0),
    ]);
    setFlows(flowResponse.data);
    setTrunks(trunkResponse.data);
  };

  useEffect(() => {
    void loadCampaigns(page);
  }, [page]);

  useEffect(() => () => {
    if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const openCreate = async () => {
    setErrorText(null);
    setSaveState('idle');
    clearInlineConfirm();
    setEditingCampaign(null);
    resetForm();
    await loadReferences();
    setCreateOpen(true);
  };

  const openEdit = async (campaign: CampaignItem) => {
    setErrorText(null);
    setSaveState('idle');
    clearInlineConfirm();
    setCreateOpen(false);
    setEditingCampaign(campaign);
    setName(campaign.name);
    setFlowId(campaign.flowId ? String(campaign.flowId) : null);
    setTrunkId(campaign.trunkId ? String(campaign.trunkId) : null);
    setCallerId(campaign.callerId || '');
    setDefaultCountry(campaign.defaultCountry || 'US');
    setScheduledAt(campaign.scheduledAt ? campaign.scheduledAt.slice(0, 16) : '');
    setScheduledAtError(null);
    setMaxConcurrent(campaign.maxConcurrent || 3);
    setMaxRetries(campaign.maxRetries || 2);
    setRetryIntervalMinutes(campaign.retryIntervalMinutes || 30);
    setContactCount(campaign.totalContacts || 0);
    setUploadFile(null);
    setUploadState('idle');
    setUploadMessage(null);
    setUploadSkippedReasons([]);
    await loadReferences();
  };

  const closeForm = () => {
    clearInlineConfirm();
    setCreateOpen(false);
    setEditingCampaign(null);
    resetForm();
  };

  useEffect(() => {
    if (!editingCampaign) {
      return;
    }
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (editPanelRef.current?.contains(target)) {
        return;
      }
      closeForm();
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [editingCampaign]);

  const clearInlineConfirm = () => {
    setConfirmDeleteId(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorText(null);
    setScheduledAtError(null);
    setSaveState('saving');

    const scheduledTimestamp = scheduledAt ? new Date(scheduledAt).getTime() : undefined;
    const shouldSchedule = Boolean(scheduledAt && scheduledTimestamp && Number.isFinite(scheduledTimestamp) && scheduledTimestamp > Date.now());

    let savedOk = false;
    try {
      const payload = {
        name,
        flowId: flowId ? Number(flowId) : null,
        trunkId: trunkId ? Number(trunkId) : null,
        callerId: callerId.trim() ? callerId.trim() : null,
        defaultCountry,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        maxConcurrent,
        maxRetries,
        retryIntervalMinutes,
      };

      const savedCampaign = editingCampaign
        ? await updateCampaign(editingCampaign.id, payload)
        : await createCampaign(payload);

      const campaignId = Number(savedCampaign.id);

      if (uploadFile && campaignId > 0) {
        setUploadState('busy');
        setUploadMessage(null);
        setUploadSkippedReasons([]);
        const uploadResult = await uploadCampaignContacts(campaignId, uploadFile);
        setUploadState('saved');
        setUploadMessage(`Imported ${uploadResult.imported} contacts, skipped ${uploadResult.skipped} invalid rows`);
        setUploadSkippedReasons(uploadResult.skipped > 0 ? uploadResult.skippedReasons || [] : []);
        setUploadFile(null);
        setContactCount((current) => (editingCampaign ? current + uploadResult.imported : uploadResult.imported));
      }

      if (!editingCampaign && shouldSchedule && campaignId > 0) {
        await scheduleCampaign(campaignId);
      }

      savedOk = true;
      setSaveState('saved');
      await loadCampaigns(page);
      showSuccess(editingCampaign ? 'Updated' : 'Created');
    } catch (error) {
      setSaveState('failed');
      setUploadState('failed');
      setErrorText(getApiError(error, 'failed to save campaign'));
    } finally {
      setSaving(false);
      if (saveFeedbackTimer.current) window.clearTimeout(saveFeedbackTimer.current);
      if (savedOk) {
        saveFeedbackTimer.current = window.setTimeout(() => {
          closeForm();
          setSaveState('idle');
        }, 2000);
      } else {
        saveFeedbackTimer.current = window.setTimeout(() => setSaveState('idle'), 2000);
      }
    }
  };

  const onCsvChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUploadFile(event.target.files?.[0] || null);
    setUploadState('idle');
    setUploadMessage(null);
    setUploadSkippedReasons([]);
  };

  const onCsvDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setUploadFile(event.dataTransfer.files?.[0] || null);
    setUploadState('idle');
    setUploadMessage(null);
    setUploadSkippedReasons([]);
  };

  const handleDelete = async (campaignId: number) => {
    setIsDeleting(true);
    clearInlineConfirm();
    setErrorText(null);
    try {
      await deleteCampaign(campaignId);
      await loadCampaigns(page);
      showSuccess('Deleted');
    } catch (error) {
      setErrorText(getApiError(error, 'failed to delete campaign'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleStop = async (campaignId: number) => {
    setErrorText(null);
    try {
      await stopCampaign(campaignId);
      await loadCampaigns(page);
    } catch (error) {
      setErrorText(getApiError(error, 'failed to stop campaign'));
    }
  };
  const actionsFor = (campaign: CampaignItem) => {
    if (campaign.status === 'draft') {
      return (
        <>
          <button className={`${styles.secondaryButton} ${styles.editButton}`} type="button" onClick={() => void openEdit(campaign)}>edit</button>
          <button
            className={`${styles.secondaryButton} ${styles.deleteButton}`}
            type="button"
            onClick={() => {
              setErrorText(null);
              setConfirmDeleteId(campaign.id);
            }}
          >
            delete
          </button>
        </>
      );
    }

    if (campaign.status === 'scheduled') {
      return (
        <>
          <button className={`${styles.secondaryButton} ${styles.editButton}`} type="button" onClick={() => void openEdit(campaign)}>edit</button>
          <button className={styles.secondaryButton} type="button" onClick={() => void handleStop(campaign.id)}>cancel</button>
        </>
      );
    }

    if (campaign.status === 'running' || campaign.status === 'cancelling') {
      return (
        <>
          <button className={styles.dangerButton} type="button" onClick={() => void handleStop(campaign.id)}>stop</button>
          <button className={`${styles.secondaryButton} ${styles.viewButton}`} type="button" onClick={() => navigate(`/campaigns/${campaign.id}`)}>view</button>
        </>
      );
    }

    return (
      <>
        <button className={`${styles.secondaryButton} ${styles.viewButton}`} type="button" onClick={() => navigate(`/campaigns/${campaign.id}`)}>view</button>
        <button
          className={`${styles.secondaryButton} ${styles.deleteButton}`}
          type="button"
          onClick={() => {
            setErrorText(null);
            setConfirmDeleteId(campaign.id);
          }}
        >
          delete
        </button>
      </>
    );
  };

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
      {!blockingLoadError ? (
        <>
      <div className={styles.pageHeader}>
        <PageLayout title="campaigns" subtitle="outbound" />
        <button
          className={styles.primaryButton}
          type="button"
          onClick={() => {
            clearInlineConfirm();
            void openCreate();
          }}
        >
          new campaign
        </button>
      </div>
        {formOpen ? (
          <>
            <section className={styles.formPanel} ref={editPanelRef}>
              <div className={styles.editPanelHeader}>
                <div className={styles.panelTitle}>{editingCampaign ? 'edit campaign' : 'new campaign'}</div>
                {editingCampaign ? (
                  <button className={styles.panelCloseButton} type="button" onClick={closeForm} aria-label="Close edit panel">×</button>
                ) : null}
              </div>
              <div id="campaign-form">
                <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>name</span>
                  <input
                    className={styles.input}
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>flow</span>
                  <SearchableSelect
                    options={flowOptions}
                    value={flowId}
                    onChange={setFlowId}
                    placeholder="select flow"
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>trunk</span>
                  <SearchableSelect
                    options={trunkOptions}
                    value={trunkId}
                    onChange={setTrunkId}
                    placeholder="select trunk"
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>caller id</span>
                  <input
                    className={styles.input}
                    placeholder="e.g. +12025551234 (overrides trunk default)"
                    value={callerId}
                    onChange={(event) => setCallerId(event.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>default country</span>
                  <SearchableSelect
                    options={COUNTRY_OPTIONS.map((option) => ({ value: option.code, label: `${option.code} — ${option.label}` }))}
                    value={defaultCountry}
                    onChange={(value) => setDefaultCountry(value || 'US')}
                    placeholder="select country"
                  />
                </label>

                <label className={`${styles.field} ${styles.scheduledField}`}>
                  <span className={styles.fieldLabel}>scheduled at</span>
                  <input
                    className={`${styles.input} ${styles.dateTimeInput}`}
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) => {
                      setScheduledAt(event.target.value);
                      setScheduledAtError(null);
                    }}
                  />
                  {scheduledAtError ? <span className={styles.failedText}>{scheduledAtError}</span> : null}
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>max concurrent calls</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrent}
                    onChange={(event) => setMaxConcurrent(Number(event.target.value))}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>max retries</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={0}
                    max={5}
                    value={maxRetries}
                    onChange={(event) => setMaxRetries(Number(event.target.value))}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>retry interval (minutes)</span>
                  <input
                    className={styles.input}
                    type="number"
                    min={5}
                    value={retryIntervalMinutes}
                    onChange={(event) => setRetryIntervalMinutes(Number(event.target.value))}
                  />
                </label>
              </div>

              <div className={styles.uploadSection}>
                  <div className={styles.panelTitle}>contacts csv</div>
                  <div className={styles.resultText}>Numbers can be local format (e.g. 0781100996) or E.164 (e.g. +94781100996). Country code applied automatically based on selected country.</div>
                  {contactCount > 0 ? <div className={styles.dataMono}>current contacts: {contactCount}</div> : null}
                  <input
                    ref={csvInputRef}
                    className={styles.hiddenInput}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={onCsvChange}
                  />
                  <button
                    className={styles.uploadZone}
                    onClick={() => csvInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={onCsvDrop}
                    type="button"
                  >
                    <span className={styles.uploadLabel}>drag and drop CSV or click to select</span>
                    <span className={styles.uploadFileName}>{uploadFile?.name || '—'}</span>
                  </button>
                  {uploadFile ? <div className={styles.resultText}>file will be uploaded when you save</div> : null}
                  {uploadMessage ? (
                    <div className={uploadState === 'failed' ? styles.failedText : styles.resultText}>{uploadMessage}</div>
                  ) : null}
                  {uploadState !== 'failed' && uploadSkippedReasons.length > 0 ? (
                    <div className={styles.skippedReasons}>
                      {uploadSkippedReasons.map((reason) => (
                        <div key={reason}>{reason}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
            </div>
            <ErrorMessage message={errorText} />
          </section>
          <div className={styles.formActions}>
            <button className={styles.secondaryButton} type="button" onClick={closeForm} disabled={saving}>cancel</button>
            <button className={saveButtonClass} type="button" onClick={() => void handleSave()} disabled={saving}>
              {saveLabel}
            </button>
          </div>
        </>
        ) : null}

        <div className={styles.tableCard}>
          {loading ? <Loading message="Loading campaigns..." /> : null}
          {!loading && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Flow</th>
                  <th>Trunk</th>
                  <th>Scheduled</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th className={styles.actionsHeader}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={styles.emptyState}>No campaigns yet.</td>
                  </tr>
                ) : campaigns.map((campaign) => {
                  const percent = campaign.totalContacts > 0
                    ? Math.max(0, Math.min(100, Math.round((campaign.answeredCount / campaign.totalContacts) * 100)))
                    : 0;
                  const showProgress = campaign.status === 'running' || campaign.status === 'completed';
                  return (
                    <tr key={campaign.id}>
                      <td className={styles.nameCell}>{campaign.name}</td>
                      <td>{campaign.flowName || '—'}</td>
                      <td>{campaign.trunkName || '—'}</td>
                      <td className={styles.mono}>{campaign.scheduledAt ? formatDateTime(campaign.scheduledAt) : '—'}</td>
                      <td>
                        <span className={`${styles.statusBadge} ${statusClass(campaign.status)}`}>
                          {statusLabel(campaign.status)}
                          {campaign.status === 'running' ? <span className={styles.pulseDot} /> : null}
                        </span>
                      </td>
                      <td>
                        {showProgress ? (
                          <div className={styles.progressInline}>
                            <span className={styles.mono}>{campaign.answeredCount}/{campaign.totalContacts}</span>
                            <span className={styles.progressTrack}><span className={styles.progressFill} style={{ width: `${percent}%` }} /></span>
                          </div>
                        ) : '—'}
                      </td>
                      <td className={styles.actionsCell}>
                        <div className={styles.actions}>{actionsFor(campaign)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {showPagination ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}
          {successText ? <div className={styles.successRibbon}>{successText}</div> : null}
          {!formOpen ? <ErrorMessage message={errorText} /> : null}
        </div>
        <ConfirmDialog
          open={confirmDeleteId !== null}
          title="Delete campaign"
          message="Delete this campaign?"
          cancelLabel="cancel"
          confirmLabel={isDeleting ? 'deleting…' : 'delete'}
          isLoading={isDeleting}
          onCancel={clearInlineConfirm}
          onConfirm={() => {
            if (confirmDeleteId !== null) {
              void handleDelete(confirmDeleteId);
            }
          }}
        />
        </>
      ) : null}
      </div>
  );
}
