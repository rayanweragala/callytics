import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { PageLayout } from '../components/common/PageLayout';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Pagination } from '../components/common/Pagination';
import { SkeletonRow } from '../components/common/skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { createExtension, deleteExtension, getHostConfig, getVpnStatus, listExtensions, updateExtension } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { formatDateTime } from '../lib/time';
import type { ExtensionItem } from '../types';
import styles from './ExtensionsPage.module.css';

interface ExtensionFormState {
  username: string;
  password: string;
  displayName: string;
  transportType: 'sip' | 'webrtc';
  vpnOnly: boolean;
}

const emptyForm: ExtensionFormState = {
  username: '',
  password: '',
  displayName: '',
  transportType: 'sip',
  vpnOnly: false,
};

export function ExtensionsPage() {
  const [items, setItems] = useState<ExtensionItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<ExtensionFormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ExtensionFormState>(emptyForm);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [qrModal, setQrModal] = useState<{ username: string; uri: string; dataUrl: string } | null>(null);
  const [hostIp, setHostIp] = useState('127.0.0.1');
  const [sipPort, setSipPort] = useState(5080);
  const [vpnInstalled, setVpnInstalled] = useState(false);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const showError = (msg: string | null) => {
    setErrorText(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (msg) errorTimerRef.current = setTimeout(() => setErrorText(null), 6000);
  };

  const showSuccess = (id: number | null) => {
    setDeletedId(id);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (id !== null) successTimerRef.current = setTimeout(() => setDeletedId(null), 6000);
  };

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.username.localeCompare(b.username)), [items]);

  function buildSipUri(username: string): string {
    return `sip:${username}@${hostIp}:${sipPort}`;
  }

  const load = async (nextLimit = limit, nextOffset = offset) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [extensionsResponse, hostConfig, vpnStatus] = await Promise.all([
        listExtensions(nextLimit, nextOffset),
        getHostConfig(),
        getVpnStatus(),
      ]);
      setItems(extensionsResponse.data);
      setTotal(extensionsResponse.total);
      setHostIp(hostConfig.hostIp);
      setSipPort(hostConfig.sipPort);
      setVpnInstalled(vpnStatus.installed);
    } catch {
      setLoadError('Failed to load extensions');
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  };

  useEffect(() => {
    void load(limit, offset);
  }, [limit, offset]);

  useEffect(() => () => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  const resetMessages = () => {
    showError(null);
    showSuccess(null);
  };

  const handleCreate = async () => {
    setBusyKey('create');
    resetMessages();
    try {
      await createExtension({
        username: createForm.username.trim(),
        password: createForm.password.trim(),
        displayName: createForm.displayName.trim() || undefined,
        transportType: createForm.transportType,
        vpnOnly: createForm.vpnOnly,
      });
      setCreateForm(emptyForm);
      setCreateOpen(false);
      setOffset(0);
      await load(limit, 0);
    } catch (error) {
      showError(getApiError(error, 'failed to create extension'));
    } finally {
      setBusyKey(null);
    }
  };

  const openEdit = (item: ExtensionItem) => {
    resetMessages();
    setCreateOpen(false);
    setConfirmDeleteId(null);
    setEditingId(item.id);
    setEditForm({
      username: item.username,
      password: item.password,
      displayName: item.displayName || '',
      transportType: item.transportType || 'sip',
      vpnOnly: Boolean(item.vpnOnly),
    });
  };

  const handleUpdate = async () => {
    if (editingId === null) return;
    setBusyKey(`edit-${editingId}`);
    resetMessages();
    try {
      await updateExtension(editingId, {
        username: editForm.username.trim(),
        password: editForm.password.trim(),
        displayName: editForm.displayName.trim() || undefined,
        transportType: editForm.transportType,
        transport_type: editForm.transportType,
        vpnOnly: editForm.vpnOnly,
      });
      setEditingId(null);
      setEditForm(emptyForm);
      await load(limit, offset);
    } catch (error) {
      showError(getApiError(error, 'failed to update extension'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (id: number) => {
    setBusyKey(`delete-${id}`);
    resetMessages();
    try {
      await deleteExtension(id);
      setConfirmDeleteId(null);
      showSuccess(id);
      if (editingId === id) {
        setEditingId(null);
      }
      const nextOffset = total - 1 <= offset && offset > 0 ? Math.max(0, offset - limit) : offset;
      setOffset(nextOffset);
      await load(limit, nextOffset);
    } catch (error) {
      showError(getApiError(error, 'failed to delete extension'));
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpenQr = async (item: ExtensionItem) => {
    setBusyKey(`qr-${item.id}`);
    resetMessages();
    try {
      const uri = buildSipUri(item.username);
      const dataUrl = await QRCode.toDataURL(uri, { width: 220, margin: 1 });
      setQrModal({ username: item.username, uri, dataUrl });
    } catch (error) {
      showError(getApiError(error, 'failed to generate qr code'));
    } finally {
      setBusyKey(null);
    }
  };

  const pageActions = (
    <button
      className={styles.primaryButton}
      onClick={() => {
        resetMessages();
        setEditingId(null);
        setCreateOpen((current) => !current);
      }}
      type="button"
    >
      {createOpen ? 'cancel' : 'add extension'}
    </button>
  );

  return (
    <PageLayout actions={pageActions} title="Extensions" subtitle="configure">
      <div className={styles.page}>

        {createOpen ? (
          <section className={styles.formPanel}>
            <div className={styles.panelTitle}>new extension</div>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>username</span>
                <input className={`${styles.input} ${styles.dataMono}`} value={createForm.username} onChange={(event) => {
                  resetMessages();
                  setCreateForm((current) => ({ ...current, username: event.target.value }));
                }} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>password</span>
                <input className={`${styles.input} ${styles.dataMono}`} value={createForm.password} onChange={(event) => {
                  resetMessages();
                  setCreateForm((current) => ({ ...current, password: event.target.value }));
                }} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>display name</span>
                <input className={styles.input} value={createForm.displayName} onChange={(event) => {
                  resetMessages();
                  setCreateForm((current) => ({ ...current, displayName: event.target.value }));
                }} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>transport</span>
                <select
                  className={styles.input}
                  value={createForm.transportType}
                  onChange={(event) => {
                    resetMessages();
                    setCreateForm((current) => ({ ...current, transportType: event.target.value === 'webrtc' ? 'webrtc' : 'sip' }));
                  }}
                >
                  <option value="sip">SIP / UDP</option>
                  <option value="webrtc">WebRTC / WSS</option>
                </select>
              </label>
              <div className={styles.formActions}>
                <button className={styles.primaryButton} type="button" onClick={() => void handleCreate()}>{busyKey === 'create' ? 'saving…' : 'save extension'}</button>
              </div>
              <div className={styles.vpnToggleField}>
                <div>
                  <div className={styles.toggleLabel}>Require VPN</div>
                  <div className={styles.toggleSubLabel}>Only allow registration from VPN subnet</div>
                </div>
                <span className={styles.tooltipWrap}>
                  <button
                    aria-checked={createForm.vpnOnly}
                    aria-label="Require VPN"
                    className={`${styles.toggleSwitch} ${createForm.vpnOnly ? styles.toggleOn : ''}`}
                    disabled={!vpnInstalled}
                    onClick={() => setCreateForm((current) => ({ ...current, vpnOnly: !current.vpnOnly }))}
                    role="switch"
                    type="button"
                  >
                    <span />
                  </button>
                  {!vpnInstalled ? <span className={styles.tooltipText}>Requires VPN to be installed</span> : null}
                </span>
              </div>
            </div>
            {errorText ? <ErrorMessage message={errorText} /> : null}
          </section>
        ) : null}

        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>username</th>
                <th>display name</th>
                <th>transport</th>
                <th>VPN only</th>
                <th>sip uri</th>
                <th>created</th>
                <th className={styles.actionsHeader}>actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }, (_, i) => (
                    <tr key={i}>
                      {[200, 160, 140, 96, 250, 108, 220].map((w, j) => (
                      <td key={j}>
                        <span className={`${styles.skeletonBar} ${styles[`skeletonW${w}`]}`} />
                      </td>
                      ))}
                    </tr>
                  ))
              ) : loadError ? (
                <tr><td colSpan={7}><ErrorMessage message={loadError} /></td></tr>
              ) : sortedItems.length === 0 ? (
                <tr><td colSpan={7} className={styles.emptyState}>No extensions yet.</td></tr>
              ) : (
                sortedItems.map((item) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td className={styles.dataMono}>{item.username}</td>
                      <td className={styles.displayName}>{item.displayName || '—'}</td>
                      <td>
                        <span className={styles.transportBadge}>{item.transportType === 'webrtc' ? 'WebRTC' : 'SIP'}</span>
                      </td>
                      <td className={styles.vpnOnlyCell}>
                        {item.vpnOnly ? <span className={styles.vpnOnlyBadge}>VPN Only</span> : <span className={styles.vpnOnlyDash}>—</span>}
                      </td>
                      <td className={styles.dataMono}>{buildSipUri(item.username)}</td>
                      <td className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</td>
                      <td className={styles.actionsCell}>
                        <div className={styles.actions}>
                          <>
                            <button className={`${styles.secondaryButton} ${styles.editButton}`} onClick={() => openEdit(item)} type="button">edit</button>
                            <button className={`${styles.secondaryButton} ${styles.qrButton}`} onClick={() => void handleOpenQr(item)} type="button">{busyKey === `qr-${item.id}` ? 'loading…' : 'qr'}</button>
                            <button className={`${styles.secondaryButton} ${styles.deleteButton}`} onClick={() => setConfirmDeleteId(item.id)} type="button">delete</button>
                          </>
                        </div>
                      </td>
                    </tr>
                    {editingId === item.id ? (
                      <tr>
                        <td colSpan={7}>
                          <div className={styles.editorRow}>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>username</span>
                              <input className={`${styles.input} ${styles.dataMono}`} value={editForm.username} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, username: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>password</span>
                              <input className={`${styles.input} ${styles.dataMono}`} value={editForm.password} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, password: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>display name</span>
                              <input className={styles.input} value={editForm.displayName} onChange={(event) => {
                                resetMessages();
                                setEditForm((current) => ({ ...current, displayName: event.target.value }));
                              }} />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.fieldLabel}>transport</span>
                              <select
                                className={styles.input}
                                value={editForm.transportType}
                                onChange={(event) => {
                                  resetMessages();
                                  setEditForm((current) => ({ ...current, transportType: event.target.value === 'webrtc' ? 'webrtc' : 'sip' }));
                                }}
                              >
                                <option value="sip">SIP / UDP</option>
                                <option value="webrtc">WebRTC / WSS</option>
                              </select>
                            </label>
                            <div className={styles.vpnToggleField}>
                              <div>
                                <div className={styles.toggleLabel}>Require VPN</div>
                                <div className={styles.toggleSubLabel}>Only allow registration from VPN subnet</div>
                              </div>
                              <span className={styles.tooltipWrap}>
                                <button
                                  aria-checked={editForm.vpnOnly}
                                  aria-label="Require VPN"
                                  className={`${styles.toggleSwitch} ${editForm.vpnOnly ? styles.toggleOn : ''}`}
                                  disabled={!vpnInstalled}
                                  onClick={() => setEditForm((current) => ({ ...current, vpnOnly: !current.vpnOnly }))}
                                  role="switch"
                                  type="button"
                                >
                                  <span />
                                </button>
                                {!vpnInstalled ? <span className={styles.tooltipText}>Requires VPN to be installed</span> : null}
                              </span>
                            </div>
                            <div className={styles.formActions}>
                              <button className={styles.secondaryButton} onClick={() => setEditingId(null)} type="button">cancel</button>
                              <button className={styles.primaryButton} type="button" onClick={() => void handleUpdate()}>{busyKey === `edit-${item.id}` ? 'saving…' : 'save changes'}</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setOffset((nextPage - 1) * limit)}
          />
          {deletedId !== null ? <div className={styles.successText}>extension deleted</div> : null}
          {errorText ? <ErrorMessage message={errorText} /> : null}
        </div>
        <ConfirmDialog
          open={confirmDeleteId !== null}
          title="Delete extension"
          message="Delete this extension? This cannot be undone."
          cancelLabel="cancel"
          confirmLabel={confirmDeleteId !== null && busyKey === `delete-${confirmDeleteId}` ? 'deleting…' : 'delete'}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            if (confirmDeleteId !== null) {
              void handleDelete(confirmDeleteId);
            }
          }}
        />

        {qrModal ? (
          <div className={styles.overlay} onClick={() => setQrModal(null)} role="presentation">
            <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div>
                  <div className={styles.fieldLabel}>qr provisioning</div>
                  <div className={styles.modalTitle}>{qrModal.username}</div>
                </div>
                <button className={styles.secondaryButton} onClick={() => setQrModal(null)} type="button">close</button>
              </div>
              <div className={styles.qrFrame}>
                <img alt={`QR code for ${qrModal.uri}`} className={styles.qrImage} src={qrModal.dataUrl} />
              </div>
              <div className={styles.uriText}>{qrModal.uri}</div>
            </div>
          </div>
        ) : null}
      </div>
    </PageLayout>
  );
}
