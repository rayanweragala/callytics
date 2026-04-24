import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { AudioPreviewPlayer } from '../audio/AudioPreviewPlayer';
import type { AudioFileItem, ContactNumber, HuntDestination } from '../../types';
import styles from './HuntConfigPanel.module.css';

interface HuntConfigPanelProps {
  nodeId: string;
  config: Record<string, unknown>;
  audioOptions: SearchableSelectOption[];
  audioItems: AudioFileItem[];
  nodeOptions: SearchableSelectOption[];
  extensionOptions: SearchableSelectOption[];
  contactOptions: SearchableSelectOption[];
  contacts: ContactNumber[];
  onConfigReplace: (nextConfig: Record<string, unknown>) => void;
}

const strategyOptions: SearchableSelectOption[] = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'random', label: 'Random' },
  { value: 'group', label: 'Group' },
];

function normalizeDestinations(config: Record<string, unknown>): HuntDestination[] {
  if (!Array.isArray(config.destinations) || config.destinations.length === 0) {
    return [{ target_type: 'extension', target_value: '', trunk_id: undefined }];
  }

  const values = config.destinations.reduce<HuntDestination[]>((acc, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return acc;
    }
    const item = value as Record<string, unknown>;
    const targetType: HuntDestination['target_type'] = item.target_type === 'pstn' ? 'pstn' : 'extension';
    const targetValue = String(item.target_value || '').trim();
    acc.push({
      target_type: targetType,
      target_value: targetValue,
      trunk_id: item.trunk_id ? Number(item.trunk_id) : undefined,
    });
    return acc;
  }, []);

  return values.length > 0 ? values : [{ target_type: 'extension', target_value: '', trunk_id: undefined }];
}

export function HuntConfigPanel({
  nodeId,
  config,
  audioOptions,
  audioItems,
  nodeOptions,
  extensionOptions,
  contactOptions,
  contacts,
  onConfigReplace,
}: HuntConfigPanelProps) {
  const strategy = String(config.strategy || 'sequential');
  const isGroup = strategy === 'group';
  const destinations = normalizeDestinations(config);
  const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const holdAudioItem = audioItems.find((item) => String(item.id) === String(config.hold_audio_file_id));
  const busyAudioItem = audioItems.find((item) => String(item.id) === String(config.busy_audio_file_id));

  const updateConfig = (patch: Record<string, unknown>) => {
    onConfigReplace({
      destinations,
      strategy,
      attempt_timeout_ms: Number(config.attempt_timeout_ms || 20000),
      total_timeout_ms: Number(config.total_timeout_ms || 60000),
      hold_audio_file_id: config.hold_audio_file_id ?? null,
      busy_audio_file_id: config.busy_audio_file_id ?? null,
      on_no_answer: String(config.on_no_answer || ''),
      ...config,
      ...patch,
    });
  };

  const updateDestination = (index: number, value: HuntDestination) => {
    const next = [...destinations];
    next[index] = value;
    updateConfig({ destinations: next });
  };

  const addDestination = () => {
    updateConfig({ destinations: [...destinations, { target_type: 'extension', target_value: '', trunk_id: undefined }] });
  };

  const removeDestination = (index: number) => {
    if (destinations.length <= 1) return;
    updateConfig({ destinations: destinations.filter((_, itemIndex) => itemIndex !== index) });
  };

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>strategy</span>
        <SearchableSelect
          options={strategyOptions}
          value={strategy}
          onChange={(value) => updateConfig({ strategy: value || 'sequential' })}
          placeholder="select strategy"
        />
      </label>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>destinations</span>
        <div className={styles.destinationsList}>
          {destinations.map((destination, index) => (
            <div className={styles.destinationCard} key={`${nodeId}-destination-${index}`}>
              <div className={styles.destinationRow}>
                <div className={styles.targetTypeCell}>
                  <select
                    className={styles.targetTypeSelect}
                    value={destination.target_type}
                    onChange={(event) => updateDestination(index, {
                      target_type: event.target.value === 'pstn' ? 'pstn' : 'extension',
                      target_value: '',
                      trunk_id: undefined,
                    })}
                  >
                    <option value="extension">Extension</option>
                    <option value="pstn">PSTN</option>
                  </select>
                </div>
                <div className={styles.targetValueCell}>
                  {destination.target_type === 'extension' ? (
                    <SearchableSelect
                      options={extensionOptions}
                      value={destination.target_value || null}
                      onChange={(value) => updateDestination(index, { ...destination, target_type: 'extension', target_value: value || '', trunk_id: undefined })}
                      placeholder="select extension"
                    />
                  ) : (
                    <SearchableSelect
                      options={contactOptions}
                      value={destination.target_value || null}
                      onChange={(value) => {
                        const matchedContact = contacts.find((item) => item.number === value);
                        updateDestination(index, {
                          ...destination,
                          target_type: 'pstn',
                          target_value: value || '',
                          trunk_id: matchedContact?.trunkId ? Number(matchedContact.trunkId) : undefined,
                        });
                      }}
                      placeholder="select contact"
                    />
                  )}
                </div>
                <button className={styles.removeButton} disabled={destinations.length <= 1} onClick={() => removeDestination(index)} type="button" aria-label="remove destination">
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className={styles.addButton} onClick={addDestination} type="button">add destination</button>
      </div>

      {!isGroup ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>attempt timeout (ms)</span>
          <input
            className={styles.input}
            type="number"
            value={String(Number(config.attempt_timeout_ms || 20000))}
            onChange={(event) => updateConfig({ attempt_timeout_ms: Number(event.target.value) || 0 })}
          />
        </label>
      ) : null}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>total timeout (ms)</span>
        <input
          className={styles.input}
          type="number"
          value={String(Number(config.total_timeout_ms || 60000))}
          onChange={(event) => updateConfig({ total_timeout_ms: Number(event.target.value) || 0 })}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>hold audio (looped while dialing)</span>
        <SearchableSelect
          options={audioOptions}
          value={config.hold_audio_file_id ? String(config.hold_audio_file_id) : null}
          onChange={(value) => updateConfig({ hold_audio_file_id: value ? Number(value) : null })}
          placeholder="none"
        />
      </label>
      {(() => {
        const srcPath = holdAudioItem?.previewUrl || holdAudioItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={holdAudioItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}

      {!isGroup ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>busy audio (played between retries)</span>
            <SearchableSelect
              options={audioOptions}
              value={config.busy_audio_file_id ? String(config.busy_audio_file_id) : null}
              onChange={(value) => updateConfig({ busy_audio_file_id: value ? Number(value) : null })}
              placeholder="none"
            />
          </label>
          {(() => {
            const srcPath = busyAudioItem?.previewUrl || busyAudioItem?.originalUrl;
            return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={busyAudioItem?.id} src={`${BASE}${srcPath}`} /> : null;
          })()}
        </>
      ) : null}

      <label className={styles.field}>
        <span className={styles.fieldLabel}>on no answer</span>
        <SearchableSelect
          options={nodeOptions.filter((option) => option.value !== nodeId)}
          value={config.on_no_answer ? String(config.on_no_answer) : null}
          onChange={(value) => updateConfig({ on_no_answer: value || '' })}
          placeholder="select fallback node"
        />
      </label>
    </div>
  );
}
