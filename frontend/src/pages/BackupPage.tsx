import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { Pagination } from '../components/common/Pagination';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import {
  createBackup,
  deleteBackup,
  fetchBackupArchive,
  getBackupConfig,
  getBackupDownloadUrl,
  listBackups,
  restoreBackupArchive,
  updateBackupConfig,
} from '../lib/api';
import { getApiError } from '../lib/apiError';
import { diagnosticsSocket } from '../lib/socket';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import type {
  BackupConfig,
  BackupHistoryItem,
  BackupInterval,
  BackupProgressEvent,
  BackupStatus,
  BackupType,
} from '../types';
import styles from './BackupPage.module.css';

interface LogLine {
  id: number;
  text: string;
}

interface RestoreOptionsState {
  restoreDb: boolean;
  restoreRecordings: boolean;
}

type RestoreTarget =
  | { kind: 'history'; id: number }
  | { kind: 'file' }
  | null;

const DEFAULT_RESTORE_OPTIONS: RestoreOptionsState = {
  restoreDb: true,
  restoreRecordings: true,
};

const INTERVAL_OPTIONS: BackupInterval[] = ['daily', 'weekly', 'custom'];

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function formatInterval(value: BackupInterval): string {
  if (value === 'daily') {
    return 'Daily';
  }
  if (value === 'weekly') {
    return 'Weekly';
  }
  return 'Custom';
}

function formatTypeLabel(value: BackupType): string {
  if (value === 'db_only') {
    return 'db only';
  }
  if (value === 'recordings_only') {
    return 'recordings only';
  }
  return 'full';
}

function formatLogLine(step: string, percentage: number): string {
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  return `[${timestamp}] ${String(percentage).padStart(3, ' ')}% ${step}`;
}

function typeBadgeClass(type: BackupType): string {
  if (type === 'db_only') {
    return styles.typeDbOnly;
  }
  if (type === 'recordings_only') {
    return styles.typeRecordingsOnly;
  }
  return styles.typeFull;
}

function statusBadgeClass(status: BackupStatus): string {
  if (status === 'complete') {
    return styles.statusComplete;
  }
  if (status === 'failed') {
    return styles.statusFailed;
  }
  if (status === 'running') {
    return styles.statusRunning;
  }
  return styles.statusPending;
}

function TerminalLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className={styles.terminalLog} ref={ref}>
      {lines.length === 0 ? <div className={styles.terminalEmpty}>waiting for activity</div> : null}
      {lines.map((line) => (
        <div className={styles.terminalLine} key={line.id}>
          {line.text}
        </div>
      ))}
    </div>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
  subLabel?: string;
}

function ToggleSwitch({ checked, label, onToggle, disabled = false, subLabel }: ToggleSwitchProps) {
  return (
    <div className={styles.toggleField}>
      <div>
        <div className={styles.toggleLabel}>{label}</div>
        {subLabel ? <div className={styles.toggleSubLabel}>{subLabel}</div> : null}
      </div>
      <button
        aria-checked={checked}
        aria-label={label}
        className={`${styles.toggleSwitch} ${checked ? styles.toggleOn : ''}`}
        disabled={disabled}
        onClick={onToggle}
        role="switch"
        type="button"
      >
        <span />
      </button>
    </div>
  );
}

export function BackupPage() {
  const windowWidth = useWindowWidth();
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [draftConfig, setDraftConfig] = useState<BackupConfig | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [createIncludeRecordings, setCreateIncludeRecordings] = useState(true);
  const [backupLog, setBackupLog] = useState<LogLine[]>([]);
  const [restoreLog, setRestoreLog] = useState<LogLine[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget>(null);
  const [restorePanelId, setRestorePanelId] = useState<number | null>(null);
  const [rowRestoreOptions, setRowRestoreOptions] = useState<Record<number, RestoreOptionsState>>({});
  const [fileRestoreOptions, setFileRestoreOptions] = useState<RestoreOptionsState>(DEFAULT_RESTORE_OPTIONS);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const logIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pushBackupLog = (text: string) => {
    logIdRef.current += 1;
    setBackupLog((current) => [...current, { id: logIdRef.current, text }]);
  };

  const pushRestoreLog = (text: string) => {
    logIdRef.current += 1;
    setRestoreLog((current) => [...current, { id: logIdRef.current, text }]);
  };

  const loadHistory = async (nextPage = page) => {
    setHistoryLoading(true);
    try {
      const response = await listBackups(nextPage, 10);
      setHistory(response.data);
      setPage(response.page);
      setTotalPages(response.totalPages);
    } catch (error) {
      setPageError(getApiError(error, 'failed to load backup history'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadConfig = async () => {
    setConfigLoading(true);
    try {
      const response = await getBackupConfig();
      setConfig(response);
      setDraftConfig(response);
    } catch (error) {
      setPageError(getApiError(error, 'failed to load backup schedule'));
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory(1);
    void loadConfig();
  }, []);

  useEffect(() => {
    if (page !== 1) {
      void loadHistory(page);
    }
  }, [page]);

  useEffect(() => {
    const handleBackupProgress = (event: BackupProgressEvent) => {
      setCreatingBackup(true);
      pushBackupLog(formatLogLine(event.step, event.percentage));
    };
    const handleBackupComplete = (event: { filename: string; sizeBytes: number }) => {
      setCreatingBackup(false);
      pushBackupLog(formatLogLine(`backup complete: ${event.filename} (${formatBytes(event.sizeBytes)})`, 100));
      void loadHistory(page);
    };
    const handleBackupError = (event: { message: string }) => {
      setCreatingBackup(false);
      pushBackupLog(formatLogLine(`backup failed: ${event.message}`, 100));
      setPageError(event.message);
      void loadHistory(page);
    };
    const handleRestoreProgress = (event: BackupProgressEvent) => {
      setRestoring(true);
      pushRestoreLog(formatLogLine(event.step, event.percentage));
    };
    const handleRestoreComplete = () => {
      setRestoring(false);
      pushRestoreLog(formatLogLine('restore complete', 100));
      void loadHistory(page);
    };
    const handleRestoreError = (event: { message: string }) => {
      setRestoring(false);
      pushRestoreLog(formatLogLine(`restore failed: ${event.message}`, 100));
      setPageError(event.message);
      void loadHistory(page);
    };
    const subscribe = () => diagnosticsSocket.emit('backup:subscribe');

    diagnosticsSocket.on('backup:progress', handleBackupProgress);
    diagnosticsSocket.on('backup:complete', handleBackupComplete);
    diagnosticsSocket.on('backup:error', handleBackupError);
    diagnosticsSocket.on('restore:progress', handleRestoreProgress);
    diagnosticsSocket.on('restore:complete', handleRestoreComplete);
    diagnosticsSocket.on('restore:error', handleRestoreError);
    diagnosticsSocket.on('connect', subscribe);

    if (diagnosticsSocket.connected) {
      subscribe();
    }

    return () => {
      diagnosticsSocket.emit('backup:unsubscribe');
      diagnosticsSocket.off('connect', subscribe);
      diagnosticsSocket.off('backup:progress', handleBackupProgress);
      diagnosticsSocket.off('backup:complete', handleBackupComplete);
      diagnosticsSocket.off('backup:error', handleBackupError);
      diagnosticsSocket.off('restore:progress', handleRestoreProgress);
      diagnosticsSocket.off('restore:complete', handleRestoreComplete);
      diagnosticsSocket.off('restore:error', handleRestoreError);
    };
  }, [page]);

  const activeStatus = useMemo(() => {
    const running = history.find((item) => item.status === 'running');
    return running || null;
  }, [history]);

  const handleRefresh = async () => {
    setPageError(null);
    try {
      await Promise.all([loadHistory(page), loadConfig()]);
    } catch (error) {
      setPageError(getApiError(error, 'failed to refresh backup page'));
    }
  };

  const handleCreateBackup = async () => {
    setPageError(null);
    setCreatingBackup(true);
    setBackupLog([]);
    pushBackupLog(formatLogLine('starting manual backup', 0));
    try {
      await createBackup({ includeRecordings: createIncludeRecordings });
      await loadHistory(page);
    } catch (error) {
      setCreatingBackup(false);
      setPageError(getApiError(error, 'failed to create backup'));
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setPageError(null);
    try {
      await deleteBackup(id);
      setDeleteConfirmId(null);
      setRestorePanelId((current) => current === id ? null : current);
      await loadHistory(page);
    } catch (error) {
      setPageError(getApiError(error, 'failed to delete backup'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestoreFromHistory = async (item: BackupHistoryItem) => {
    const options = rowRestoreOptions[item.id] || DEFAULT_RESTORE_OPTIONS;
    setPageError(null);
    setRestoring(true);
    setRestoreTarget({ kind: 'history', id: item.id });
    setRestoreLog([]);
    pushRestoreLog(formatLogLine(`loading ${item.filename}`, 0));
    try {
      const archive = await fetchBackupArchive(item.id);
      const file = new File([archive.blob], archive.filename, { type: 'application/gzip' });
      await restoreBackupArchive(file, options);
      await loadHistory(page);
    } catch (error) {
      setRestoring(false);
      setPageError(getApiError(error, 'failed to restore backup'));
    }
  };

  const handleRestoreFromFile = async () => {
    if (!selectedFile) {
      setPageError('backup file is required');
      return;
    }
    setPageError(null);
    setRestoring(true);
    setRestoreTarget({ kind: 'file' });
    setRestoreLog([]);
    pushRestoreLog(formatLogLine(`uploading ${selectedFile.name}`, 0));
    try {
      await restoreBackupArchive(selectedFile, fileRestoreOptions);
      await loadHistory(page);
    } catch (error) {
      setRestoring(false);
      setPageError(getApiError(error, 'failed to restore backup'));
    }
  };

  const handleSaveSchedule = async () => {
    if (!draftConfig) {
      return;
    }
    setConfigSaving(true);
    setPageError(null);
    try {
      const response = await updateBackupConfig({
        enabled: draftConfig.enabled,
        interval: draftConfig.interval,
        cronExpression: draftConfig.interval === 'custom' ? draftConfig.cronExpression : null,
        includeRecordings: draftConfig.includeRecordings,
        retentionCount: draftConfig.retentionCount,
      });
      setConfig(response);
      setDraftConfig(response);
    } catch (error) {
      setPageError(getApiError(error, 'failed to save backup schedule'));
    } finally {
      setConfigSaving(false);
    }
  };

  const setRowOption = (id: number, patch: Partial<RestoreOptionsState>) => {
    setRowRestoreOptions((current) => ({
      ...current,
      [id]: {
        ...(current[id] || DEFAULT_RESTORE_OPTIONS),
        ...patch,
      },
    }));
  };

  const isInitialLoading = (historyLoading || configLoading) && !config && history.length === 0;

  if (isInitialLoading) {
    return (
      <PageLayout
        title="Backup & Restore"
        subtitle="system"
        actions={<button className={styles.secondaryButton} onClick={() => void handleRefresh()} type="button">refresh</button>}
      >
        <Loading message="Loading backup page..." />
      </PageLayout>
    );
  }

  if (pageError) {
    return (
      <PageLayout
        title="Backup & Restore"
        subtitle="system"
      >
        <ErrorMessage message={pageError} />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Backup & Restore"
      subtitle="system"
      actions={<button className={styles.secondaryButton} onClick={() => void handleRefresh()} type="button">refresh</button>}
    >
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.page}>
        <section className={styles.statusBar}>
          <span className={`${styles.statusDot} ${config?.enabled ? styles.statusDotActive : styles.statusDotMuted}`} />
          <span>schedule <strong>{config?.enabled ? 'enabled' : 'disabled'}</strong></span>
          <span>interval <strong>{config ? formatInterval(config.interval) : '—'}</strong></span>
          <span>next backup <strong>{config?.nextRunAt ? formatDateTime(config.nextRunAt) : 'not scheduled'}</strong></span>
          <span>retention <strong>{config ? `${config.retentionCount} backups` : '—'}</strong></span>
          {activeStatus ? <span className={styles.warningText}>active job {activeStatus.filename}</span> : null}
        </section>

        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>Backups</div>
              <div className={styles.sectionHint}>Create archives of database, recordings, and audio files, then download or restore them.</div>
            </div>
            <div className={styles.headerActions}>
              <ToggleSwitch
                checked={createIncludeRecordings}
                label="Include recordings"
                onToggle={() => setCreateIncludeRecordings((current) => !current)}
              />
              <button className={`${styles.primaryButton} btn-press`} disabled={creatingBackup || restoring} onClick={() => void handleCreateBackup()} type="button">
                {creatingBackup ? 'creating…' : 'Create Backup'}
              </button>
            </div>
          </div>

          {creatingBackup || backupLog.length > 0 ? <TerminalLog lines={backupLog} /> : null}

          <div className={styles.restoreUploadCard}>
            <div className={styles.subsectionHeader}>
              <div className={styles.subsectionTitle}>Restore from file</div>
              <div className={styles.sectionHint}>Upload a `.tar.gz` archive and choose what to restore.</div>
            </div>
            <input
              accept=".tar.gz,application/gzip"
              className={styles.hiddenInput}
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              ref={inputRef}
              type="file"
            />
            <button
              className={styles.dropZone}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                setSelectedFile(event.dataTransfer.files?.[0] || null);
              }}
              type="button"
            >
              <span className={styles.dropLabel}>drag backup archive here or click to browse</span>
              <span className={styles.dropFileName}>{selectedFile?.name || '—'}</span>
            </button>

            <div className={styles.restoreControls}>
              <ToggleSwitch
                checked={fileRestoreOptions.restoreDb}
                label="Restore database"
                onToggle={() => setFileRestoreOptions((current) => ({ ...current, restoreDb: !current.restoreDb }))}
              />
              <ToggleSwitch
                checked={fileRestoreOptions.restoreRecordings}
                label="Restore recordings"
                onToggle={() => setFileRestoreOptions((current) => ({ ...current, restoreRecordings: !current.restoreRecordings }))}
              />
              <button
                className={`${styles.primaryButton} btn-press`}                disabled={restoring || !selectedFile}
                onClick={() => void handleRestoreFromFile()}
                type="button"
              >
                {restoring && restoreTarget?.kind === 'file' ? 'restoring…' : 'Confirm Restore'}
              </button>
            </div>

            {restoreTarget?.kind === 'file' && (restoring || restoreLog.length > 0) ? <TerminalLog lines={restoreLog} /> : null}
          </div>

          <div className={styles.tableCard}>
            {historyLoading ? (
              <Loading message="Loading backups..." />
            ) : history.length === 0 ? (
              <div className={styles.emptyState}>No backups yet. Create one to start your archive history.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className={styles.actionsHeader}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((item) => {
                    const options = rowRestoreOptions[item.id] || DEFAULT_RESTORE_OPTIONS;
                    const isRestoreOpen = restorePanelId === item.id;
                    const isRestoreActive = restoreTarget?.kind === 'history' && restoreTarget.id === item.id;

                    return (
                      <Fragment key={item.id}>
                        <tr key={item.id}>
                          <td className={styles.fileCell}>
                            <div className={styles.fileName}>{item.filename}</div>
                            {item.notes ? <div className={styles.fileMeta}>{item.notes}</div> : null}
                          </td>
                          <td>
                            <span className={`${styles.typeBadge} ${typeBadgeClass(item.type)}`}>{formatTypeLabel(item.type)}</span>
                          </td>
                          <td className={styles.monoCell}>{formatBytes(item.sizeBytes)}</td>
                          <td className={styles.monoCell}>{formatDateTime(item.createdAt)}</td>
                          <td>
                            <span className={`${styles.statusBadge} ${statusBadgeClass(item.status)}`}>
                              {item.status === 'running' ? <span className={styles.pulseDot} aria-hidden="true" /> : null}
                              {item.status}
                            </span>
                          </td>
                          <td className={styles.actionsCell}>
                            {deleteConfirmId === item.id ? (
                              <div className={styles.inlineConfirm}>
                                <button className={`${styles.secondaryButton} ${styles.confirmDeleteButton}`} disabled={deletingId === item.id} onClick={() => void handleDelete(item.id)} type="button">
                                  {deletingId === item.id ? 'deleting…' : 'confirm'}
                                </button>
                                <button className={styles.secondaryButton} onClick={() => setDeleteConfirmId(null)} type="button" aria-label={`Cancel delete ${item.filename}`}>
                                  cancel
                                </button>
                              </div>
                            ) : (
                              <div className={styles.actions}>
                                <a
                                  aria-label={`Download ${item.filename}`}
                                  className={`${styles.secondaryButton} ${styles.actionButton}`}
                                  href={getBackupDownloadUrl(item.id)}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  download
                                </a>
                                <button
                                  aria-label={`Restore ${item.filename}`}
                                  className={`${styles.secondaryButton} ${styles.actionButton}`}
                                  onClick={() => setRestorePanelId((current) => current === item.id ? null : item.id)}
                                  type="button"
                                >
                                  restore
                                </button>
                                <button
                                  aria-label={`Delete ${item.filename}`}
                                  className={`${styles.secondaryButton} ${styles.actionButton} ${styles.deleteActionButton}`}
                                  onClick={() => setDeleteConfirmId(item.id)}
                                  type="button"
                                >
                                  delete
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {isRestoreOpen ? (
                          <tr>
                            <td className={styles.restorePanelCell} colSpan={6}>
                              <div className={styles.inlineRestorePanel}>
                                <div className={styles.restoreControls}>
                                  <ToggleSwitch
                                    checked={options.restoreDb}
                                    label="Restore database"
                                    onToggle={() => setRowOption(item.id, { restoreDb: !options.restoreDb })}
                                  />
                                  <ToggleSwitch
                                    checked={options.restoreRecordings}
                                    label="Restore recordings"
                                    onToggle={() => setRowOption(item.id, { restoreRecordings: !options.restoreRecordings })}
                                  />
                                  <button
                                    className={`${styles.primaryButton} btn-press`}
                                    disabled={restoring}
                                    onClick={() => void handleRestoreFromHistory(item)}
                                    type="button"
                                  >
                                    {restoring && isRestoreActive ? 'restoring…' : 'Confirm Restore'}
                                  </button>
                                </div>
                                {isRestoreActive && (restoring || restoreLog.length > 0) ? <TerminalLog lines={restoreLog} /> : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}

            <Pagination onPageChange={setPage} page={page} totalPages={totalPages} />
          </div>
        </section>

        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionTitle}>Schedule</div>
              <div className={styles.sectionHint}>Control automated backups and archive retention.</div>
            </div>
          </div>

          {draftConfig ? (
            <div className={`${styles.scheduleCard} ${draftConfig.enabled ? '' : styles.scheduleDisabled}`}>
              <ToggleSwitch
                checked={draftConfig.enabled}
                label="Enable scheduled backups"
                onToggle={() => setDraftConfig((current) => current ? { ...current, enabled: !current.enabled } : current)}
              />

              <div className={styles.scheduleBody}>
                <div className={styles.fieldBlock}>
                  <div className={styles.fieldLabel}>Interval</div>
                  <div className={styles.intervalGroup}>
                    {INTERVAL_OPTIONS.map((option) => (
                      <button
                        className={`${styles.secondaryButton} ${draftConfig.interval === option ? styles.intervalButtonActive : ''}`}
                        key={option}
                        onClick={() => setDraftConfig((current) => current ? {
                          ...current,
                          interval: option,
                          cronExpression: option === 'custom' ? current.cronExpression : null,
                        } : current)}
                        type="button"
                      >
                        {formatInterval(option)}
                      </button>
                    ))}
                  </div>
                </div>

                {draftConfig.interval === 'custom' ? (
                  <label className={styles.fieldBlock}>
                    <span className={styles.fieldLabel}>Cron expression</span>
                    <input
                      className={styles.input}
                      onChange={(event) => setDraftConfig((current) => current ? { ...current, cronExpression: event.target.value } : current)}
                      type="text"
                      value={draftConfig.cronExpression || ''}
                    />
                  </label>
                ) : null}

                <ToggleSwitch
                  checked={draftConfig.includeRecordings}
                  label="Include recordings"
                  onToggle={() => setDraftConfig((current) => current ? { ...current, includeRecordings: !current.includeRecordings } : current)}
                />

                <label className={styles.fieldBlock}>
                  <span className={styles.fieldLabel}>Keep last N backups</span>
                  <input
                    className={styles.input}
                    min={1}
                    onChange={(event) => setDraftConfig((current) => current ? {
                      ...current,
                      retentionCount: Math.max(1, Number(event.target.value) || 1),
                    } : current)}
                    type="number"
                    value={draftConfig.retentionCount}
                  />
                </label>
              </div>

              <div className={styles.saveRow}>
                <button className={styles.secondaryButton} disabled={configSaving} onClick={() => void handleSaveSchedule()} type="button">
                  {configSaving ? 'saving…' : 'Save'}
                </button>
                <div className={styles.savedAt}>last saved {formatDateTime(draftConfig.updatedAt)}</div>
              </div>
            </div>
          ) : (
            <Loading message="Loading schedule..." />
          )}
        </section>
      </div>
    </PageLayout>
  );
}
