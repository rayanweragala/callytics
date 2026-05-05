import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createTts, deleteAudio, listAudio, listAudioVoices, previewTts as requestTtsPreview, uploadAudio } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import { AudioUploadZone } from '../components/audio/AudioUploadZone';
import { Pagination } from '../components/common/Pagination';
import { PageLayout } from '../components/common/PageLayout';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { SkeletonRow } from '../components/common/skeleton';
import { ErrorMessage } from '../components/common/ErrorMessage';
import { ConfirmDialog } from '../components/ConfirmDialog/ConfirmDialog';
import { DesktopRequired } from '../components/DesktopRequired/DesktopRequired';
import type { AudioFileItem, AudioVoiceItem } from '../types';
import { formatDateTime } from '../lib/time';
import { useWindowWidth } from '../hooks/useWindowWidth';
import styles from './AudioPage.module.css';

const backendBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
const DEFAULT_TTS_VOICE = 'en_US-lessac-medium';
type ActionState = 'idle' | 'busy' | 'saved' | 'failed';
type PreviewState = 'idle' | 'busy' | 'failed';

export function AudioPage() {
  const windowWidth = useWindowWidth();
  const uploadTimerRef = useRef<number | null>(null);
  const ttsTimerRef = useRef<number | null>(null);
  const previewErrorTimerRef = useRef<number | null>(null);
  const deletedTimerRef = useRef<number | null>(null);
  const failedDeleteTimerRef = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [items, setItems] = useState<AudioFileItem[]>([]);
  const [voices, setVoices] = useState<AudioVoiceItem[]>([]);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [ttsText, setTtsText] = useState('');
  const [ttsVoice, setTtsVoice] = useState(DEFAULT_TTS_VOICE);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [ttsPitch, setTtsPitch] = useState(0);
  const [normalizeVolume, setNormalizeVolume] = useState(true);
  const [uploadState, setUploadState] = useState<ActionState>('idle');
  const [ttsState, setTtsState] = useState<ActionState>('idle');
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [ttsFieldErrors, setTtsFieldErrors] = useState<{ text?: string }>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [failedDeleteId, setFailedDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(5);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const showPagination = total > 0;

  const load = async (nextPage = page, nextLimit = limit) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [audioResponse, voicesResponse] = await Promise.all([
        listAudio(nextPage, nextLimit),
        listAudioVoices()
      ]);
      setItems(audioResponse.data);
      setTotal(audioResponse.total);
      setPage(audioResponse.page);
      setLimit(audioResponse.limit);
      setTotalPages(audioResponse.totalPages);
      setVoices(voicesResponse.data);
      
      if (voicesResponse.data.length > 0 && !voicesResponse.data.find((v) => v.value === ttsVoice)) {
        const defaultVoice = voicesResponse.data.find((v) => v.value === DEFAULT_TTS_VOICE);
        setTtsVoice((defaultVoice || voicesResponse.data[0]).value);
      }
    } catch (error) {
      setLoadError(getApiError(error, 'failed to load audio'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load(page, limit);
    return () => {
      [uploadTimerRef, ttsTimerRef, previewErrorTimerRef, deletedTimerRef, failedDeleteTimerRef].forEach(ref => {
        if (ref.current) window.clearTimeout(ref.current);
      });
      clearPreview();
    };
  }, [page, limit]);

  const clearPreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  };

  const showPreviewError = (msg: string | null) => {
    setPreviewError(msg);
    if (previewErrorTimerRef.current) window.clearTimeout(previewErrorTimerRef.current);
    if (msg) {
      previewErrorTimerRef.current = window.setTimeout(() => setPreviewError(null), 6000);
    }
  };

  const resetLater = (kind: 'upload' | 'tts') => {
    const timerRef = kind === 'upload' ? uploadTimerRef : ttsTimerRef;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (kind === 'upload') {
        setUploadState('idle');
        setUploadError(null);
      } else {
        setTtsState('idle');
        setTtsError(null);
      }
    }, 6000);
  };

  const clearUploadFeedback = () => {
    if (uploadTimerRef.current) window.clearTimeout(uploadTimerRef.current);
    setUploadError(null);
    setUploadState('idle');
  };

  const clearTtsFeedback = () => {
    if (ttsTimerRef.current) window.clearTimeout(ttsTimerRef.current);
    setTtsError(null);
    setTtsState('idle');
    showPreviewError(null);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploadState('busy');
    setUploadError(null);
    try {
      await uploadAudio(uploadFile, uploadName);
      setUploadFile(null);
      setUploadName('');
      await load(page, limit);
      setUploadState('saved');
    } catch (error) {
      setUploadState('failed');
      setUploadError(getApiError(error, 'upload failed'));
    } finally {
      resetLater('upload');
    }
  };

  const validateTts = (): boolean => {
    const nextErrors: { text?: string } = {};
    if (!ttsText.trim()) nextErrors.text = 'prompt text is required';
    setTtsFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handlePreview = async () => {
    if (!validateTts()) return;
    setPreviewState('busy');
    showPreviewError(null);
    try {
      const blob = await requestTtsPreview({ voice: ttsVoice, text: ttsText, speed: ttsSpeed, pitch: ttsPitch, normalizeVolume });
      if (!blob.size) throw new Error('preview returned empty audio');
      clearPreview();
      const nextUrl = URL.createObjectURL(blob);
      previewUrlRef.current = nextUrl;
      setPreviewUrl(nextUrl);
      setPreviewState('idle');
    } catch (error) {
      clearPreview();
      setPreviewState('failed');
      showPreviewError(getApiError(error, 'preview failed'));
    }
  };

  const handleTts = async () => {
    if (!validateTts()) return;
    setTtsState('busy');
    setTtsError(null);
    try {
      await createTts({ name: '', text: ttsText, voice: ttsVoice, speed: ttsSpeed, pitch: ttsPitch, normalizeVolume });
      clearPreview();
      setTtsText('');
      setTtsSpeed(1);
      setTtsPitch(0);
      setNormalizeVolume(true);
      setTtsFieldErrors({});
      await load(page, limit);
      setTtsState('saved');
    } catch (error) {
      setTtsState('failed');
      setTtsError(getApiError(error, 'save failed'));
    } finally {
      resetLater('tts');
    }
  };

  const confirmDelete = async (id: number) => {
    try {
      await deleteAudio(id);
      setDeletedId(id);
      if (deletedTimerRef.current) window.clearTimeout(deletedTimerRef.current);
      deletedTimerRef.current = window.setTimeout(() => setDeletedId(c => c === id ? null : c), 6000);
      setConfirmId(null);
      void load(page, limit);
    } catch {
      setFailedDeleteId(id);
      if (failedDeleteTimerRef.current) window.clearTimeout(failedDeleteTimerRef.current);
      failedDeleteTimerRef.current = window.setTimeout(() => setFailedDeleteId(c => c === id ? null : c), 6000);
      setConfirmId(null);
    }
  };

  const voiceOptions = useMemo(() => voices.map(v => ({ value: v.value, label: v.label })), [voices]);
  const blockingLoadError = !isLoading ? loadError : null;

  return (
    <div className={styles.page}>
      {windowWidth < 768 ? <DesktopRequired /> : null}
      <div className={styles.pageHeader}>
        <PageLayout title="audio" subtitle="configure" />
      </div>
      {blockingLoadError ? <ErrorMessage message={blockingLoadError} /> : null}
      {!blockingLoadError ? (
        <>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>upload audio</div>
          <div className={styles.form}>
            <input className={styles.input} placeholder="display name" value={uploadName} onChange={(e) => { clearUploadFeedback(); setUploadName(e.target.value); }} />
            <AudioUploadZone file={uploadFile} onFileSelect={(f) => { clearUploadFeedback(); setUploadFile(f); }} />
            <div className={styles.actionRow}>
              <button className={uploadState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton} type="button" onClick={() => void handleUpload()}>
                {uploadState === 'busy' ? 'uploading…' : uploadState === 'saved' ? 'uploaded ✓' : uploadState === 'failed' ? 'failed' : 'upload'}
              </button>
              {uploadError && <div className={styles.failedText}>{uploadError}</div>}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}>piper tts</div>
          <div className={styles.ttsFormGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>voice</span>
              <SearchableSelect options={voiceOptions} value={ttsVoice} onChange={(v) => { clearTtsFeedback(); setTtsVoice(v || ''); }} />
            </label>
            <div className={styles.normalizeToggleField}>
              <div>
                <div className={styles.toggleLabel}>Normalize volume</div>
                <div className={styles.toggleSubLabel}>Run generated audio through loudnorm</div>
              </div>
              <button
                aria-checked={normalizeVolume}
                aria-label="Normalize volume"
                className={`${styles.toggleSwitch} ${normalizeVolume ? styles.toggleOn : ''}`}
                onClick={() => { clearTtsFeedback(); setNormalizeVolume((current) => !current); }}
                role="switch"
                type="button"
              >
                <span />
              </button>
            </div>
            <label className={styles.field}>
              <div className={styles.sliderHeader}>
                <span className={styles.fieldLabel}>Speed</span>
                <span className={styles.sliderValue}>{ttsSpeed.toFixed(1)}</span>
              </div>
              <input type="range" min={0.5} max={2} step={0.1} value={ttsSpeed} onChange={(e) => { clearTtsFeedback(); setTtsSpeed(Number(e.target.value)); }} />
            </label>
            <label className={styles.field}>
              <div className={styles.sliderHeader}>
                <span className={styles.fieldLabel}>Pitch</span>
                <span className={styles.sliderValue}>{ttsPitch}</span>
              </div>
              <input type="range" min={-10} max={10} step={1} value={ttsPitch} onChange={(e) => { clearTtsFeedback(); setTtsPitch(Number(e.target.value)); }} />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span className={styles.fieldLabel}>text</span>
              <textarea className={styles.textarea} value={ttsText} onChange={(e) => { setTtsText(e.target.value); clearTtsFeedback(); setTtsFieldErrors(c => ({ ...c, text: undefined })); }} />
              {ttsFieldErrors.text && <div className={styles.fieldError}>{ttsFieldErrors.text}</div>}
            </label>
            <div className={styles.ttsActions}>
              <button className={styles.previewButton} type="button" disabled={previewState === 'busy'} onClick={() => void handlePreview()}>
                {previewState === 'busy' ? 'previewing…' : 'preview'}
              </button>
              <button className={ttsState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton} type="button" onClick={() => void handleTts()}>
                {ttsState === 'busy' ? 'saving…' : ttsState === 'saved' ? 'saved ✓' : ttsState === 'failed' ? 'failed' : 'save'}
              </button>
            </div>
            {(previewError || ttsError) && <div className={styles.failedText}>{previewError || ttsError}</div>}
            {previewUrl && (
              <div className={styles.previewBlock}>
                <div className={styles.previewLabel}>temporary preview</div>
                <AudioPreviewPlayer autoPlay src={previewUrl} />
              </div>
            )}
          </div>
        </section>
      </div>

      <div className={styles.tableCard}>
        {isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonRow key={i} columns={[{ width: '20%' }, { width: '15%' }, { width: '15%' }, { width: '15%' }, { width: '20%' }, { width: '15%' }]} />
            ))}
          </>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>status</th>
                <th>preview</th>
                <th>created</th>
                <th className={styles.actionsHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles.emptyState}>No audio yet.</td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className={styles.name}>{item.name}</div>
                    <div className={styles.meta}>{item.ttsVoice || item.originalFilename || '—'}</div>
                  </td>
                  <td className={styles.meta}>{item.sourceType}</td>
                  <td className={styles.meta}>{item.conversionStatus}</td>
                  <td>
                    {item.previewUrl ? <AudioPreviewPlayer src={`${backendBase}${item.previewUrl}`} /> : <span className={styles.meta}>—</span>}
                  </td>
                  <td className={styles.createdAt}>{formatDateTime(item.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      {deletedId === item.id ? (
                        <div className={styles.deletedText}>deleted</div>
                      ) : (
                        <>
                          <button className={`${styles.secondaryButton} ${styles.deleteButton}`} onClick={() => setConfirmId(item.id)}>delete</button>
                          {failedDeleteId === item.id && <div className={styles.failedText}>failed</div>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showPagination ? <Pagination page={page} totalPages={totalPages} onPageChange={setPage} /> : null}
      </div>
        </>
      ) : null}
      <ConfirmDialog
        open={confirmId !== null}
        title="Delete audio"
        message="Delete this audio?"
        cancelLabel="cancel"
        confirmLabel="delete"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId !== null) {
            void confirmDelete(confirmId);
          }
        }}
      />
    </div>
  );
}
