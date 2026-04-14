import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createTts, deleteAudio, listAudio, listAudioVoices, uploadAudio } from '../lib/api';
import { AudioPreviewPlayer } from '../components/audio/AudioPreviewPlayer';
import { AudioUploadZone } from '../components/audio/AudioUploadZone';
import { Pagination } from '../components/common/Pagination';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { formatDate } from '../lib/time';
import type { AudioFileItem, AudioVoiceItem } from '../types';
import styles from './AudioPage.module.css';

const backendBase = 'http://localhost:3001';
type ActionState = 'idle' | 'busy' | 'saved' | 'failed';

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
  const [items, setItems] = useState<AudioFileItem[]>([]);
  const [voices, setVoices] = useState<AudioVoiceItem[]>([]);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [ttsName, setTtsName] = useState('');
  const [ttsText, setTtsText] = useState('');
  const [ttsVoice, setTtsVoice] = useState('en_US-lessac-medium');
  const [uploadState, setUploadState] = useState<ActionState>('idle');
  const [ttsState, setTtsState] = useState<ActionState>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletedId, setDeletedId] = useState<number | null>(null);
  const [failedDeleteId, setFailedDeleteId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(5);
  const [totalPages, setTotalPages] = useState(1);

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
    }, 3000);
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
      setUploadError(error instanceof Error ? error.message : 'upload failed');
    } finally {
      resetLater('upload');
    }
  };

  const handleTts = async (event: FormEvent) => {
    event.preventDefault();
    setTtsState('busy');
    setTtsError(null);
    try {
      await createTts({ name: ttsName || 'Generated TTS', text: ttsText, voice: ttsVoice });
      setTtsName('');
      setTtsText('');
      await load(page, limit);
      setTtsState('saved');
    } catch (error) {
      setTtsState('failed');
      setTtsError(error instanceof Error ? error.message : 'generation failed');
    } finally {
      resetLater('tts');
    }
  };

  const confirmDelete = async (id: number) => {
    try {
      await deleteAudio(id);
      setDeletedId(id);
      setConfirmId(null);
      window.setTimeout(() => {
        void load(page, limit);
        setDeletedId((current) => (current === id ? null : current));
      }, 1200);
    } catch {
      setFailedDeleteId(id);
      setConfirmId(null);
      window.setTimeout(() => setFailedDeleteId((current) => (current === id ? null : current)), 2000);
    }
  };

  const voiceOptions = useMemo(
    () => voices.map((voice) => ({ value: voice.id, label: humanizeVoice(voice.id) })),
    [voices],
  );

  const uploadLabel = uploadState === 'busy' ? 'uploading…' : uploadState === 'saved' ? 'uploaded ✓' : uploadState === 'failed' ? 'failed' : 'upload';
  const ttsLabel = ttsState === 'busy' ? 'generating…' : ttsState === 'saved' ? 'generated ✓' : ttsState === 'failed' ? 'failed' : 'generate';
  const uploadButtonClass = uploadState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;
  const ttsButtonClass = ttsState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <div className={styles.sectionLabel}>configure</div>
          <h1 className={styles.title}>audio</h1>
        </div>
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}>upload audio</div>
          <form className={styles.form} onSubmit={(event) => void handleUpload(event)}>
            <input className={styles.input} placeholder="display name" value={uploadName} onChange={(event) => setUploadName(event.target.value)} />
            <AudioUploadZone file={uploadFile} onFileSelect={setUploadFile} />
            <div className={styles.actionRow}>
              <button className={uploadButtonClass} type="submit">{uploadLabel}</button>
              {uploadError ? <div className={styles.failedText}>{uploadError}</div> : null}
            </div>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}>piper tts</div>
          <form className={styles.form} onSubmit={(event) => void handleTts(event)}>
            <input className={styles.input} placeholder="asset name" value={ttsName} onChange={(event) => setTtsName(event.target.value)} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>voice</span>
              <SearchableSelect
                options={voiceOptions}
                value={ttsVoice}
                onChange={(value) => setTtsVoice(value || '')}
                placeholder="select voice"
              />
            </label>
            <textarea className={styles.textarea} placeholder="Enter prompt text" value={ttsText} onChange={(event) => setTtsText(event.target.value)} />
            <div className={styles.actionRow}>
              <button className={ttsButtonClass} type="submit">{ttsLabel}</button>
              {ttsError ? <div className={styles.failedText}>{ttsError}</div> : null}
            </div>
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
            <div className={styles.createdAt} title={item.createdAt}>{formatDate(item.createdAt)}</div>
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
    </div>
  );
}
