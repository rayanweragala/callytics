import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import styles from './HuntConfigPanel.module.css';

interface HuntConfigPanelProps {
  nodeId: string;
  config: Record<string, unknown>;
  audioOptions: SearchableSelectOption[];
  nodeOptions: SearchableSelectOption[];
  onConfigReplace: (nextConfig: Record<string, unknown>) => void;
}

const strategyOptions: SearchableSelectOption[] = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'random', label: 'Random' },
  { value: 'group', label: 'Group' },
];

function normalizeDestinations(config: Record<string, unknown>): string[] {
  if (!Array.isArray(config.destinations) || config.destinations.length === 0) {
    return [''];
  }

  const values = config.destinations.map((value) => String(value || ''));
  return values.length > 0 ? values : [''];
}

export function HuntConfigPanel({
  nodeId,
  config,
  audioOptions,
  nodeOptions,
  onConfigReplace,
}: HuntConfigPanelProps) {
  const strategy = String(config.strategy || 'sequential');
  const isGroup = strategy === 'group';
  const destinations = normalizeDestinations(config);

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

  const updateDestination = (index: number, value: string) => {
    const next = [...destinations];
    next[index] = value;
    updateConfig({ destinations: next });
  };

  const addDestination = () => {
    updateConfig({ destinations: [...destinations, ''] });
  };

  const removeDestination = (index: number) => {
    if (destinations.length <= 1) {
      return;
    }
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
            <div className={styles.destinationRow} key={`${nodeId}-destination-${index}`}>
              <input
                className={styles.input}
                placeholder="SIP/101"
                value={destination}
                onChange={(event) => updateDestination(index, event.target.value)}
              />
              <button className={styles.removeButton} disabled={destinations.length <= 1} onClick={() => removeDestination(index)} type="button">
                remove
              </button>
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

      {!isGroup ? (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>busy audio (played between retries)</span>
          <SearchableSelect
            options={audioOptions}
            value={config.busy_audio_file_id ? String(config.busy_audio_file_id) : null}
            onChange={(value) => updateConfig({ busy_audio_file_id: value ? Number(value) : null })}
            placeholder="none"
          />
        </label>
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
