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
    <PageLayout title="IVR Templates" subtitle="configure">
      <ErrorMessage message={errorText} />
      {loading ? <Loading message="Loading templates..." /> : null}
      {!loading ? (
        <div className={styles.grid}>
          {items.map((item) => (
            <article className={styles.card} key={item.id}>
              <div className={styles.category}>{item.templateCategory || 'general'}</div>
              <h2 className={styles.name}>{item.name}</h2>
              <p className={styles.description}>{item.templateDescription || item.description || 'No description provided.'}</p>
              <div className={styles.meta}>{item.nodeCount} nodes</div>
              <button
                className={styles.importButton}
                disabled={busyId === item.id}
                onClick={() => setPendingImportId(item.id)}
                type="button"
              >
                {busyId === item.id ? 'Importing...' : 'Import'}
              </button>
            </article>
          ))}
        </div>
      ) : null}

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
    </PageLayout>
  );
}
