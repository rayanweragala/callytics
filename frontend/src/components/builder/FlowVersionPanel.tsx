/**
 * FlowVersionPanel — version history sidebar.
 *
 * Purely presentational: no API calls.
 * onRestore delegates back to the parent (FlowEditorPage) which calls
 * useFlowData.restoreVersion.
 *
 * The commit row (message input + save button) and compare action are
 * included here alongside the version list — they are inseparable from
 * the versions sidebar UX and only appear together.
 */
import type { FlowVersionSummary } from '../../types';
import { formatDateTime } from '../../lib/time';
import styles from './FlowVersionPanel.module.css';

export interface FlowVersionPanelProps {
  versions: FlowVersionSummary[];
  currentVersionId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onRestore: (versionId: number) => void;
  onCompare: (version: FlowVersionSummary) => void;
  // Commit row
  versionMessage: string;
  onVersionMessageChange: (value: string) => void;
  versionSaveState: 'idle' | 'saving';
  onCreateVersion: () => void;
  versionNotice: string | null;
  versionsLoading: boolean;
}

export function FlowVersionPanel({
  versions,
  isOpen,
  onClose,
  onRestore,
  onCompare,
  versionMessage,
  onVersionMessageChange,
  versionSaveState,
  onCreateVersion,
  versionNotice,
  versionsLoading,
}: FlowVersionPanelProps) {
  return (
    <aside className={`${styles.versionsPanel} ${isOpen ? styles.versionsPanelOpen : ''}`}>
      <div className={styles.versionsHeader}>
        <div className={styles.versionsTitle}>versions</div>
        <button className={styles.secondaryButton} onClick={onClose} type="button">×</button>
      </div>
      <div className={styles.versionsCommitRow}>
        <input
          className={styles.input}
          placeholder="Describe this version..."
          value={versionMessage}
          onChange={(event) => onVersionMessageChange(event.target.value)}
        />
        <button
          className={styles.primaryButton}
          disabled={!versionMessage.trim() || versionSaveState === 'saving'}
          onClick={onCreateVersion}
          type="button"
        >
          {versionSaveState === 'saving' ? 'saving…' : 'save'}
        </button>
      </div>
      {versionNotice ? <div className={styles.versionNotice}>{versionNotice}</div> : null}
      <div className={styles.versionsList}>
        {versionsLoading ? <div className={styles.empty}>loading versions…</div> : null}
        {!versionsLoading && versions.length === 0 ? (
          <div className={styles.empty}>No committed versions yet.</div>
        ) : null}
        {!versionsLoading
          ? versions.map((version) => (
              <div className={styles.versionItem} key={version.id}>
                <div className={styles.versionMetaRow}>
                  <div className={styles.versionNum}>v{version.versionNum}</div>
                  <div className={styles.meta}>{formatDateTime(version.createdAt)}</div>
                  <div className={styles.meta}>{version.nodeCount} nodes</div>
                </div>
                <div className={styles.versionMessage}>{version.message}</div>
                <div className={styles.versionActions}>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => onRestore(version.id)}
                    type="button"
                  >
                    restore
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => onCompare(version)}
                    type="button"
                  >
                    compare
                  </button>
                </div>
              </div>
            ))
          : null}
      </div>
    </aside>
  );
}
