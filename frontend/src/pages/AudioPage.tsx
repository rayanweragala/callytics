import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createTts, deleteAudio, listAudio, listAudioVoices, previewTts as requestTtsPreview, uploadAudio } from '../lib/api';
import { getApiError } from '../lib/apiError';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import { AudioUploadZone } from '../components/audio/AudioUploadZone';
import { Pagination } from '../components/common/Pagination';
import { PageLayout } from '../components/common/PageLayout';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { formatDateTime } from '../lib/time';
import type { AudioFileItem, AudioVoiceItem } from '../types';
import styles from './AudioPage.module.css';

const backendBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
type ActionState = 'idle' | 'busy' | 'saved' | 'failed';
type PreviewState = 'idle' | 'busy' | 'failed';

function humanizeVoice(id: string): string {
  const match = id.match(/^([a-z]{2})_([A-Z]{2})-([^-]+)-(.+)$/i);
  if (!match) return id;
  const [, languageCode, regionCode, voiceName, quality] = match;
  const languages: Record<string, string> = {
    ar: 'Arabic', bg: 'Bulgarian', ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish', de: 'German',
    el: 'Greek', en: 'English', es: 'Spanish', eu: 'Basque', fa: 'Persian', fi: 'Finnish', fr: 'French',
    hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', is: 'Icelandic', it: 'Italian', ka: 'Georgian',
    kk: 'Kazakh', ku: 'Kurdish', lb: 'Luxembourgish', lv: 'Latvian', ml: 'Malayalam', ne: 'Nepali',
    nl: 'Dutch', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian',
    sk: 'Slovak', sl: 'Slovenian', sq: 'Albanian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili',
    te: 'Telugu', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese', zh: 'Chinese',
  };
  const voiceLabel = voiceName.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const qualityLabel = quality.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  return `${languages[languageCode.toLowerCase()] || languageCode.toUpperCase()} (${regionCode.toUpperCase()}) — ${voiceLabel} ${qualityLabel}`;
}

export function AudioPage() {
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
  const [ttsName, setTtsName] = useState('');
  const [ttsText, setTtsText] = useState('');
  const [ttsVoice, setTtsVoice] = useState('en_US-lessac-medium');
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [uploadState, setUploadState] = useState<ActionState>('idle');
  const [ttsState, setTtsState] = useState<ActionState>('idle');
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [ttsFieldErrors, setTtsFieldErrors] = useState<{ name?: string; text?: string }>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [failedDeleteId, setFailedDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);
  const [totalPages, setTotalPages] = useState(1);

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

  const load = async (nextPage = page, nextLimit = limit) => {
    const [audioResponse, voicesResponse] = await Promise.all([listAudio(nextPage, nextLimit), listAudioVoices()]);
    setItems(audioResponse.data);
    setPage(audioResponse.page);
    setLimit(audioResponse.limit);
    setTotalPages(audioResponse.totalPages);
    setVoices(voicesResponse.data);
    if (voicesResponse.data.length > 0 && !voicesResponse.data.find((voice) => voice.id === ttsVoice)) {
      setTtsVoice(voicesResponse.data[0].id);
    }
  };

  useEffect(() => {
    void load(page, limit);
    return () => {
      if (uploadTimerRef.current) window.clearTimeout(uploadTimerRef.current);
      if (ttsTimerRef.current) window.clearTimeout(ttsTimerRef.current);
      if (previewErrorTimerRef.current) window.clearTimeout(previewErrorTimerRef.current);
      if (deletedTimerRef.current) window.clearTimeout(deletedTimerRef.current);
      if (failedDeleteTimerRef.current) window.clearTimeout(failedDeleteTimerRef.current);
      clearPreview();
    };
  }, [page, limit]);

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
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

  const validateTts = (mode: 'preview' | 'save'): boolean => {
    const nextErrors: { name?: string; text?: string } = {};
    if (mode === 'save' && !ttsName.trim()) {
      nextErrors.name = 'asset name is required';
    }
    if (!ttsText.trim()) {
      nextErrors.text = 'prompt text is required';
    }
    setTtsFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handlePreview = async () => {
    if (!validateTts('preview')) {
      showPreviewError(null);
      return;
    }

    setPreviewState('busy');
    showPreviewError(null);

    try {
      const blob = await requestTtsPreview({ voice: ttsVoice, text: ttsText, speed: ttsSpeed });
      if (!blob.size) {
        throw new Error('preview returned empty audio');
      }
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

  const handleTts = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateTts('save')) {
      return;
    }

    setTtsState('busy');
    setTtsError(null);
    try {
      await createTts({ name: ttsName.trim(), text: ttsText, voice: ttsVoice, speed: ttsSpeed });
      clearPreview();
      setTtsName('');
      setTtsText('');
      setTtsSpeed(1);
      showPreviewError(null);
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
      deletedTimerRef.current = window.setTimeout(() => setDeletedId((current) => (current === id ? null : current)), 6000);
      setConfirmId(null);
      void load(page, limit);
    } catch {
      setFailedDeleteId(id);
      if (failedDeleteTimerRef.current) window.clearTimeout(failedDeleteTimerRef.current);
      failedDeleteTimerRef.current = window.setTimeout(() => setFailedDeleteId((current) => (current === id ? null : current)), 6000);
      setConfirmId(null);
    }
  };

  const voiceOptions = useMemo(
    () => voices.map((voice) => ({ value: voice.id, label: humanizeVoice(voice.id) })),
    [voices],
  );

  const uploadLabel = uploadState === 'busy' ? 'uploading…' : uploadState === 'saved' ? 'uploaded ✓' : uploadState === 'failed' ? 'failed' : 'upload';
  const saveLabel = ttsState === 'busy' ? 'saving…' : ttsState === 'saved' ? 'saved ✓' : ttsState === 'failed' ? 'failed' : 'save';
  const previewLabel = previewState === 'busy' ? 'previewing…' : 'preview';
  const uploadButtonClass = uploadState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const saveButtonClass = ttsState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const speedProgress = ((ttsSpeed - 0.5) / 1.5) * 100;

  return (
    <PageLayout title="audio" subtitle="configure">
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>upload audio</div>
          <form className={styles.form} onSubmit={(event) => void handleUpload(event)}>
            <input className={styles.input} placeholder="display name" value={uploadName} onChange={(event) => {
              clearUploadFeedback();
              setUploadName(event.target.value);
            }} aria-label="Audio file display name" />
            <AudioUploadZone file={uploadFile} onFileSelect={(file) => {
              clearUploadFeedback();
              setUploadFile(file);
            }} />
            <div className={styles.actionRow}>
              <button className={uploadButtonClass} type="submit" aria-label="Upload audio file">{uploadLabel}</button>
              {uploadError ? <div className={styles.failedText}>{uploadError}</div> : null}
            </div>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}>piper tts</div>
          <form className={styles.form} onSubmit={(event) => void handleTts(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>asset name</span>
              <input
                className={styles.input}
                placeholder="asset name"
                value={ttsName}
                onChange={(event) => {
                  setTtsName(event.target.value);
                  clearTtsFeedback();
                  setTtsFieldErrors((current) => ({ ...current, name: undefined }));
                }}
                aria-label="TTS asset name"
              />
              {ttsFieldErrors.name ? <div className={styles.fieldError}>{ttsFieldErrors.name}</div> : null}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>voice</span>
              <SearchableSelect
                options={voiceOptions}
                value={ttsVoice}
                onChange={(value) => {
                  clearTtsFeedback();
                  setTtsVoice(value || '');
                }}
                placeholder="select voice"
              />
            </label>
            <label className={styles.field}>
              <div className={styles.sliderHeader}>
                <span className={styles.fieldLabel}>speed</span>
                <span className={styles.sliderValue}><span className={styles.dataValue}>{ttsSpeed.toFixed(1)}</span>×</span>
              </div>
              <div className={styles.sliderShell}>
                <div className={styles.sliderTrack}>
                  <div className={styles.sliderFill} style={{ width: `${speedProgress}%` }} />
                </div>
                <input
                  className={styles.slider}
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={ttsSpeed}
                  onChange={(event) => {
                    clearTtsFeedback();
                    setTtsSpeed(Number(event.target.value));
                  }}
                />
              </div>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>prompt</span>
              <textarea
                className={styles.textarea}
                placeholder="Enter prompt text"
                value={ttsText}
                onChange={(event) => {
                  setTtsText(event.target.value);
                  clearTtsFeedback();
                  setTtsFieldErrors((current) => ({ ...current, text: undefined }));
                }}
                aria-label="TTS prompt text"
              />
              {ttsFieldErrors.text ? <div className={styles.fieldError}>{ttsFieldErrors.text}</div> : null}
            </label>
            <div className={styles.ttsActions}>
              <button className={styles.previewButton} disabled={previewState === 'busy'} onClick={() => void handlePreview()} type="button" aria-label="Preview TTS audio">{previewLabel}</button>
              <button className={saveButtonClass} type="submit" aria-label="Generate and save TTS audio">{saveLabel}</button>
            </div>
            {previewError ? <div className={styles.failedText}>{previewError}</div> : null}
            {ttsError ? <div className={styles.failedText}>{ttsError}</div> : null}
            {previewUrl ? (
              <div className={styles.previewBlock}>
                <div className={styles.previewLabel}>temporary preview</div>
                <AudioPreviewPlayer autoPlay src={previewUrl} />
              </div>
            ) : null}
          </form>
        </section>
      </div>

      <section className={styles.libraryPanel}>
        <div className={styles.panelTitle}>audio library</div>
        <div className={styles.tableHead}>
          <div>name</div>
          <div>source</div>
          <div>status</div>
          <div>preview</div>
          <div>created</div>
          <div className={styles.actionsHeader}>actions</div>
        </div>
        {items.length === 0 ? (
          <div className={styles.empty}>No audio yet.</div>
        ) : items.map((item) => (
          <div className={styles.row} key={item.id}>
            <div>
              <div className={styles.name}>{item.name}</div>
              <div className={styles.meta}>{item.ttsVoice || item.originalFilename || '—'}</div>
            </div>
            <div className={styles.meta}>{item.sourceType}</div>
            <div className={styles.meta}>{item.conversionStatus}</div>
            <div>
              {item.previewUrl ? <AudioPreviewPlayer src={`${backendBase}${item.previewUrl}`} /> : <span className={styles.meta}>—</span>}
            </div>
            <div className={styles.createdAt} title={item.createdAt}>{formatDateTime(item.createdAt)}</div>
            <div className={styles.actions}>
              {deletedId === item.id ? (
                <div className={styles.deletedText}>deleted</div>
              ) : confirmId === item.id ? (
                <div className={styles.confirmBox}>
                  <div className={styles.confirmText}>Delete this audio? This cannot be undone.</div>
                  <div className={styles.confirmActions}>
                    <button className={styles.secondaryButton} onClick={() => setConfirmId(null)} type="button">cancel</button>
                    <button className={styles.deleteButton} onClick={() => void confirmDelete(item.id)} type="button">delete</button>
                  </div>
                </div>
              ) : (
                <>
                  <button className={styles.secondaryButton} onClick={() => setConfirmId(item.id)} type="button">delete</button>
                  {failedDeleteId === item.id ? <div className={styles.failedText}>failed to delete</div> : null}
                </>
              )}
            </div>
          </div>
        ))}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </section>
    </PageLayout>
  );
}
