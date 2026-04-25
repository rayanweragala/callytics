import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { getApiError } from '../lib/apiError';
import { importTemplate, listTemplates } from '../lib/api';
import type { TemplateItem } from '../types';
import styles from './TemplatesPage.module.css';

export function TemplatesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingImportId, setPendingImportId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setErrorText(null);
      setLoading(true);
      try {
        const response = await listTemplates();
        if (!active) return;
        setItems(response.data);
      } catch (error) {
        if (!active) return;
        setErrorText(getApiError(error, 'failed to load templates'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const handleImport = async (id: number) => {
    setBusyId(id);
    setErrorText(null);
    try {
      const response = await importTemplate(id);
      navigate(`/flows/${response.data.id}`);
    } catch (error) {
      setErrorText(getApiError(error, 'failed to import template'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageLayout title="IVR Templates" subtitle="configure" />
      </div>
      <ErrorMessage message={errorText} />
      {loading ? null : (
        <div className={styles.tableCard}>
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>description</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={3} className={styles.emptyState}>No templates available.</td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>{item.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 2 }}>{item.templateCategory || 'general'} · {item.nodeCount} nodes</div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{item.templateDescription || item.description || '—'}</td>
                    <td>
                      <button
                        className={styles.importButton}
                        disabled={busyId === item.id}
                        onClick={() => setPendingImportId(item.id)}
                        type="button"
                      >
                        {busyId === item.id ? 'Importing...' : 'Import'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Import"
        message="This will create a new flow from the template. You can edit it in the flow builder."
        onCancel={() => setPendingImportId(null)}
        onConfirm={() => {
          if (pendingImportId !== null) {
            void handleImport(pendingImportId);
          }
          setPendingImportId(null);
        }}
        open={pendingImportId !== null}
        title="Import Template"
      />
    </div>
  );
}
