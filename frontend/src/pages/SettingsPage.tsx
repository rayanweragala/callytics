import { useEffect, useRef, useState } from 'react';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { Loading } from '../components/common/Loading';
import { PageLayout } from '../components/common/PageLayout';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import { useWindowWidth } from '../hooks/useWindowWidth';
import { getSettings, updateSettings } from '../lib/api';
import { getApiError } from '../lib/apiError';
import styles from './SettingsPage.module.css';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function SettingsPage() {
  const windowWidth = useWindowWidth();
  const saveTimerRef = useRef<number | null>(null);
  const [retentionDays, setRetentionDays] = useState('0');
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  useEffect(() => {
    const loadSettings = async () => {
      setLoadError(null);
      try {
        const settings = await getSettings();
        setRetentionDays(String(settings.recording_retention_days ?? 0));
      } catch (error) {
        setLoadError(getApiError(error, 'failed to load settings'));
      } finally {
        setInitialLoading(false);
      }
    };

    void loadSettings();

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const handleSave = async () => {
    const parsedValue = Number(retentionDays);
    if (!Number.isInteger(parsedValue) || parsedValue < 0) {
      setSaveState('failed');
      setSaveError('retention days must be a non-negative whole number');
      return;
    }

    setSaveState('saving');
    setSaveError(null);

    try {
      const settings = await updateSettings({ recording_retention_days: parsedValue });
      setRetentionDays(String(settings.recording_retention_days ?? parsedValue));
      setSaveState('saved');
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => setSaveState('idle'), 2000);
    } catch (error) {
      setSaveState('failed');
      setSaveError(getApiError(error, 'failed to save settings'));
    }
  };

  if (windowWidth < 768) {
    return <DesktopRequired />;
  }

  if (initialLoading) {
    return (
      <PageLayout title="Settings" subtitle="system">
        <Loading message="Loading settings..." />
      </PageLayout>
    );
  }

  if (loadError) {
    return (
      <PageLayout title="Settings" subtitle="system">
        <ErrorMessage message={loadError} />
      </PageLayout>
    );
  }

  const saveLabel = saveState === 'saving'
    ? 'saving…'
    : saveState === 'saved'
      ? 'saved ✓'
      : saveState === 'failed'
        ? 'failed'
        : 'save';

  return (
    <PageLayout title="Settings" subtitle="system">
      <div className={styles.page}>
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Recordings</h2>
          </div>
          <div className={styles.formField}>
            <label className={styles.label} htmlFor="recording-retention-days">
              Delete recordings older than (days)
            </label>
            <input
              className={styles.input}
              id="recording-retention-days"
              min="0"
              onChange={(event) => setRetentionDays(event.target.value)}
              type="number"
              value={retentionDays}
            />
            <p className={styles.note}>Set to 0 to keep recordings indefinitely.</p>
          </div>
          <div className={styles.actionRow}>
            <button
              className={`${styles.primaryButton} ${saveState === 'failed' ? styles.failedButton : ''}`}
              disabled={saveState === 'saving'}
              onClick={() => void handleSave()}
              type="button"
            >
              {saveLabel}
            </button>
          </div>
          {saveError ? <ErrorMessage message={saveError} /> : null}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Security</h2>
          </div>
          <p className={styles.bodyText}>
            TLS and security hardening options coming soon.
          </p>
        </section>
      </div>
    </PageLayout>
  );
}
