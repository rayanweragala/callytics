import { Fragment, FormEvent, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Pagination } from '../components/common/Pagination';
import { createExtension, deleteExtension, getHostConfig, listExtensions, updateExtension } from '../lib/api';
import { formatDateTime } from '../lib/time';
import type { ExtensionItem } from '../types';
import styles from './ExtensionsPage.module.css';

interface ExtensionFormState {
  username: string;
  password: string;
  displayName: string;
}

const emptyForm: ExtensionFormState = {
  username: '',
  password: '',
  displayName: '',
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
  const [qrModal, setQrModal] = useState<{ username: string; uri: string; dataUrl: string } | null>(null);
  const [hostIp, setHostIp] = useState('127.0.0.1');
  const [sipPort, setSipPort] = useState(5080);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.username.localeCompare(b.username)), [items]);

  function buildSipUri(username: string): string {
    return `sip:${username}@${hostIp}:${sipPort}`;
  }

  const load = async (nextLimit = limit, nextOffset = offset) => {
    const [extensionsResponse, hostConfig] = await Promise.all([
      listExtensions(nextLimit, nextOffset),
      getHostConfig(),
    ]);
    setItems(extensionsResponse.data);
    setTotal(extensionsResponse.total);
    setHostIp(hostConfig.hostIp);
    setSipPort(hostConfig.sipPort);
  };

  useEffect(() => {
    void load(limit, offset);
  }, [limit, offset]);

  const resetMessages = () => {
    setErrorText(null);
    setDeletedId(null);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusyKey('create');
    resetMessages();
    try {
      await createExtension({
        username: createForm.username.trim(),
        password: createForm.password.trim(),
        displayName: createForm.displayName.trim() || undefined,
      });
      setCreateForm(emptyForm);
      setCreateOpen(false);
      setOffset(0);
      await load(limit, 0);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to create extension');
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
    });
  };

  const handleUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (editingId === null) return;
    setBusyKey(`edit-${editingId}`);
    resetMessages();
    try {
      await updateExtension(editingId, {
        username: editForm.username.trim(),
        password: editForm.password.trim(),
        displayName: editForm.displayName.trim() || undefined,
      });
      setEditingId(null);
      setEditForm(emptyForm);
      await load(limit, offset);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to update extension');
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
      setDeletedId(id);
      if (editingId === id) {
        setEditingId(null);
      }
      const nextOffset = total - 1 <= offset && offset > 0 ? Math.max(0, offset - limit) : offset;
      setOffset(nextOffset);
      await load(limit, nextOffset);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'failed to delete extension');
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
      setErrorText(error instanceof Error ? error.message : 'failed to generate qr code');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.sectionLabel}>configure</div>
          <h1 className={styles.title}>extensions</h1>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => {
            resetMessages();
            setEditingId(null);
            setCreateOpen((current) => !current);
          }}
          type="button"
        >
          {createOpen ? 'cancel' : '+ add extension'}
        </button>
      </div>

      {createOpen ? (
        <section className={styles.formPanel}>
          <div className={styles.panelTitle}>new extension</div>
          <form className={styles.formGrid} onSubmit={(event) => void handleCreate(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>username</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.username} onChange={(event) => setCreateForm((current) => ({ ...current, username: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>password</span>
              <input className={`${styles.input} ${styles.dataMono}`} value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>display name</span>
              <input className={styles.input} value={createForm.displayName} onChange={(event) => setCreateForm((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <div className={styles.formActions}>
              <button className={styles.primaryButton} type="submit">{busyKey === 'create' ? 'saving…' : 'save extension'}</button>
            </div>
          </form>
          {errorText ? <div className={styles.failedText}>{errorText}</div> : null}
        </section>
      ) : (
        <section className={styles.tablePanel}>
          <div className={styles.tableHead}>
            <div>username</div>
            <div>display name</div>
            <div>sip uri</div>
            <div>created</div>
            <div className={styles.actionsHeader}>actions</div>
          </div>
          {sortedItems.length === 0 ? (
            <div className={styles.empty}>No extensions yet.</div>
          ) : sortedItems.map((item) => (
            <Fragment key={item.id}>
              <div className={styles.row}>
                <div className={styles.dataMono}>{item.username}</div>
                <div className={styles.displayName}>{item.displayName || '—'}</div>
                <div className={styles.dataMono}>{buildSipUri(item.username)}</div>
                <div className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</div>
                <div className={styles.actions}>
                  {confirmDeleteId === item.id ? (
                    <div className={styles.confirmBox}>
                      <div className={styles.confirmText}>Delete this extension? This cannot be undone.</div>
                      <div className={styles.confirmActions}>
                        <button className={styles.secondaryButton} onClick={() => setConfirmDeleteId(null)} type="button">cancel</button>
                        <button className={styles.deleteButton} onClick={() => void handleDelete(item.id)} type="button">
                          {busyKey === `delete-${item.id}` ? 'deleting…' : 'delete'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className={styles.secondaryButton} onClick={() => openEdit(item)} type="button">edit</button>
                      <button className={styles.secondaryButton} onClick={() => void handleOpenQr(item)} type="button">{busyKey === `qr-${item.id}` ? 'loading…' : 'qr'}</button>
                      <button className={styles.secondaryButton} onClick={() => setConfirmDeleteId(item.id)} type="button">delete</button>
                    </>
                  )}
                </div>
              </div>
              {editingId === item.id ? (
                <form className={styles.editorRow} onSubmit={(event) => void handleUpdate(event)}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>username</span>
                    <input className={`${styles.input} ${styles.dataMono}`} value={editForm.username} onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>password</span>
                    <input className={`${styles.input} ${styles.dataMono}`} value={editForm.password} onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>display name</span>
                    <input className={styles.input} value={editForm.displayName} onChange={(event) => setEditForm((current) => ({ ...current, displayName: event.target.value }))} />
                  </label>
                  <div className={styles.formActions}>
                    <button className={styles.secondaryButton} onClick={() => setEditingId(null)} type="button">cancel</button>
                    <button className={styles.primaryButton} type="submit">{busyKey === `edit-${item.id}` ? 'saving…' : 'save changes'}</button>
                  </div>
                </form>
              ) : null}
            </Fragment>
          ))}
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setOffset((nextPage - 1) * limit)}
          />
          {deletedId !== null ? <div className={styles.successText}>extension deleted</div> : null}
          {errorText ? <div className={styles.failedText}>{errorText}</div> : null}
        </section>
      )}

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
  );
}
