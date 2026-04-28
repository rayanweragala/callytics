import type { Edge, Node } from 'reactflow';
import type { AudioFileItem, BuilderNodeType, CallbackNodeConfig, ConferenceNodeConfig, ContactNumber, ExtensionItem, FlowNodeData, OperatorItem, QueueItem, SipTrunkItem, TransferNodeConfig } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';
import { AudioPreviewPlayer } from '../audio/AudioPreviewPlayer';
import { HuntConfigPanel } from '../panels/HuntConfigPanel';
import styles from './NodeConfigPanel.module.css';
import pageStyles from '../../pages/FlowEditorPage.module.css';

// TODO(cleanup): VITE_API_BASE_URL base URL constant is redeclared
// multiple times inside this file. Consolidate to a single
// module-level constant in a future cleanup pass.

type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
  isSubflowJump?: boolean;
  onDelete?: (edgeId: string) => void;
};

const menuBranchOptions = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
const menuRoutableBranchSet = new Set(menuBranchOptions);
const conditionValues = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'timeout', 'invalid', 'default'];
const businessHoursDays: Array<{ key: string; label: string }> = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

function sanitizeMenuBranches(value: unknown): string[] {
  if (!Array.isArray(value)) return ['1', '2'];
  const branches = value
    .map((item) => String(item || '').trim())
    .filter((item) => menuRoutableBranchSet.has(item));
  return branches.length > 0 ? Array.from(new Set(branches)) : ['1', '2'];
}

export interface NodeConfigPanelMenuExtra {
  submenuNodeOptionsLoading: boolean;
  submenuStartNodeKey: string | null;
  selectedMenuLocalEdgeBranches: Set<string>;
  selectedMenuSubmenuTargets: Record<string, string>;
}

export interface NodeConfigPanelProps {
  selectedNode: Node<FlowNodeData> | null;
  selectedEdge: Edge<BuilderEdgeData> | null;
  selectedEdgeSourceNode: Node<FlowNodeData> | null;
  audioItems: AudioFileItem[];
  nodes: Array<Node<FlowNodeData>>;
  onLabelChange: (value: string) => void;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  onConfigReplace: (nextConfig: Record<string, unknown>) => void;
  onEdgeConditionChange: (value: string | null) => void;
  onMenuBranchToggle: (branch: string, checked: boolean) => void;
  onMenuSubflowTargetChange: (branch: string, targetNodeKey: string | null) => void;
  
  menuExtra: NodeConfigPanelMenuExtra;
  flowDefaultTimeout?: number;
  queueItems?: QueueItem[];
  extensions?: ExtensionItem[];
  operators?: OperatorItem[];
  contactNumbers?: ContactNumber[];
  trunks?: SipTrunkItem[];
  saveAttempted?: boolean;
}

// ── Node type → accent color ──────────────────────────────────────────────────
function nodeTypeColor(type: string): string {
  switch (type) {
    case 'start': case 'hangup': return 'var(--color-active)';
    case 'play_audio': return 'var(--primitive-cyan)';
    case 'get_digits': case 'menu': case 'business_hours': return 'var(--accent)';
    case 'transfer': case 'hunt': return 'var(--primitive-blue)';
    case 'queue': case 'queue_login': return 'var(--primitive-navy-300)';
    case 'conference': return '#2dd4bf';
    case 'callback': return 'var(--primitive-orange)';
    default: return 'var(--text-muted)';
  }
}

export function NodeConfigPanel({
  selectedNode,
  selectedEdge,
  selectedEdgeSourceNode,
  audioItems,
  nodes,
  onLabelChange,
  onConfigChange,
  onConfigValueChange,
  onConfigReplace,
  onEdgeConditionChange,
  onMenuBranchToggle,
  menuExtra,
  flowDefaultTimeout = 10000,
  queueItems,
  extensions = [],
  operators = [],
  contactNumbers = [],
  trunks = [],
  saveAttempted = false,
}: NodeConfigPanelProps) {
  const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const audioFileSelected = Number(selectedConfig.audio_file_id || 0) > 0;
  const promptAudioSelected = Number(selectedConfig.prompt_audio_file_id || 0) > 0;
  const selectedMenuBranches = sanitizeMenuBranches(selectedConfig.branches);

  const audioOptions = audioItems.map((item) => ({ value: String(item.id), label: item.name }));
  const nodeOptions = nodes.map((node) => ({ value: node.id, label: `${node.id} — ${node.data.label}` }));
  const extensionOptions = extensions.map((ext) => ({ value: ext.username, label: ext.displayName ? `${ext.username} — ${ext.displayName}` : ext.username }));
  const extensionIdOptions = extensions.map((ext) => ({ value: String(ext.id), label: ext.displayName ? `${ext.username} — ${ext.displayName}` : ext.username }));
  const operatorOptions = operators.map((operator) => {
    const number = operator.contactNumber?.number || operator.callbackNumber || '';
    return { value: String(operator.id), label: number ? `${operator.name} — ${number}` : operator.name };
  });
  const contactOptions = contactNumbers.map((item) => ({ value: item.number, label: `${item.label} — ${item.number}` }));
  const trunkOptions = trunks.map((trunk) => ({ value: String(trunk.id), label: trunk.name }));
  const transferTargetTypeOptions = [
    { value: 'extension', label: 'Extension' },
    { value: 'pstn', label: 'PSTN Number' },
    { value: 'sip_uri', label: 'SIP URI' },
  ];
  const callbackDestinationTypeOptions = [
    { value: 'extension', label: 'Extension' },
    { value: 'pstn', label: 'PSTN Number' },
  ];
  const conditionOptions = conditionValues.map((value) => ({ value, label: value }));
  const selectedVoicemailAudio = selectedConfig.prompt_audio_file_id
    ? audioItems.find((item) => item.id === Number(selectedConfig.prompt_audio_file_id))
    : null;

  const playAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.audio_file_id));
  const getDigitsAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.prompt_audio_file_id));
  const transferWaitingAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.waiting_sound_id));
  const transferNoAnswerAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.no_answer_sound_id));
  const callbackDtmfPromptAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.dtmf_prompt_audio_id));
  const callbackConfirmationAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.confirmation_audio_id));

  const edgeConditionOptions = (() => {
    if (!selectedEdge || !selectedEdgeSourceNode) return [] as Array<{ value: string; label: string }>;
    if (selectedEdgeSourceNode.data.type === 'menu') {
      const menuBranches = sanitizeMenuBranches(selectedEdgeSourceNode.data.config.branches);
      return [...menuBranches, 'complete'].map((value) => ({ value, label: value }));
    }
    if (selectedEdgeSourceNode.data.type === 'get_digits') return conditionOptions;
    return [] as Array<{ value: string; label: string }>;
  })();

  return (
    <>
      {/* Config panel header */}
      {selectedNode || selectedEdge ? (
        <div className={pageStyles.configPanelHeader}>
          <span
            className={pageStyles.configPanelAccentBar}
            style={{ background: nodeTypeColor(selectedNode?.data.type ?? (selectedEdgeSourceNode?.data.type ?? 'hangup')) }}
          />
          <div className={pageStyles.configPanelMeta}>
            <div className={pageStyles.configPanelType}>
              {selectedEdge ? 'edge config' : (selectedNode?.data.type ?? '')}
            </div>
            <div className={pageStyles.configPanelId}>
              {selectedEdge ? `${selectedEdge.source} → ${selectedEdge.target}` : (selectedNode?.id ?? '')}
            </div>
          </div>
        </div>
      ) : null}
      <div className={pageStyles.configScrollArea}>
        {selectedEdge ? (
          <div className={styles.form}>
          {selectedEdgeSourceNode &&
          (selectedEdgeSourceNode.data.type === 'get_digits' || selectedEdgeSourceNode.data.type === 'menu') ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>condition</span>
              <SearchableSelect
                options={edgeConditionOptions}
                value={selectedEdge.data?.condition || selectedEdge.data?.branchKey || null}
                onChange={onEdgeConditionChange}
                placeholder="select condition"
              />
              {saveAttempted && !selectedEdge.data?.condition && !selectedEdge.data?.branchKey ? (
                <span className={styles.inlineError}>Condition is required</span>
              ) : null}
            </label>
          ) : null}
          <div className={styles.meta}>source: {selectedEdge.source}</div>
          <div className={styles.meta}>target: {selectedEdge.target}</div>
        </div>
      ) : selectedNode ? (
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>label</span>
            <input
              className={styles.input}
              value={selectedNode.data.label}
              onChange={(event) => onLabelChange(event.target.value)}
            />
          </label>

          {selectedNode.data.type === 'play_audio' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>audio file</span>
                <SearchableSelect
                  options={audioOptions}
                  value={selectedConfig.audio_file_id ? String(selectedConfig.audio_file_id) : null}
                  onChange={(value) => onConfigChange('audio_file_id', value || '')}
                  placeholder="built-in path / manual"
                />
              </label>
              {(() => {
                const srcPath = playAudioItem?.previewUrl || playAudioItem?.originalUrl;
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={playAudioItem.id} src={`${BASE}${srcPath}`} /> : null;
              })()}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>audio_file_path</span>
                <input
                  className={styles.input}
                  disabled={audioFileSelected}
                  placeholder={audioFileSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                  value={audioFileSelected ? 'disabled — using audio file above' : String(selectedConfig.audio_file_path || '')}
                  onChange={(event) => onConfigChange('audio_file_path', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {selectedNode.data.type === 'start' ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>flow default timeout (ms)</span>
              <input
                className={styles.input}
                type="number"
                min={1000}
                max={120000}
                value={String(selectedConfig.flow_default_timeout_ms ?? selectedConfig.queue_login_default_input_timeout_ms ?? 10000)}
                onChange={(event) => onConfigChange('flow_default_timeout_ms', event.target.value)}
              />
              <span className={styles.meta}>Used by nodes configured to use flow default timeout.</span>
            </label>
          ) : null}

          {selectedNode.data.type === 'get_digits' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>prompt audio</span>
                <SearchableSelect
                  options={audioOptions}
                  value={selectedConfig.prompt_audio_file_id ? String(selectedConfig.prompt_audio_file_id) : null}
                  onChange={(value) => onConfigChange('prompt_audio_file_id', value || '')}
                  placeholder="built-in path / manual"
                />
              </label>
              {(() => {
                const srcPath = getDigitsAudioItem?.previewUrl || getDigitsAudioItem?.originalUrl;
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={getDigitsAudioItem.id} src={`${BASE}${srcPath}`} /> : null;
              })()}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>prompt_path</span>
                <input
                  className={styles.input}
                  disabled={promptAudioSelected}
                  placeholder={promptAudioSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                  value={promptAudioSelected ? 'disabled — using audio file above' : String(selectedConfig.prompt_path || '')}
                  onChange={(event) => onConfigChange('prompt_path', event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>timeout_ms</span>
                <input
                  className={styles.input}
                  type="number"
                  value={selectedConfig.timeout_ms === null || selectedConfig.timeout_ms === undefined ? '' : String(selectedConfig.timeout_ms)}
                  onChange={(event) => onConfigChange('timeout_ms', event.target.value)}
                  placeholder="use flow default"
                />
              </label>
            </>
          ) : null}

          {selectedNode.data.type === 'menu' ? (
            <MenuConfig
              selectedNode={selectedNode}
              selectedConfig={selectedConfig}
              selectedMenuBranches={selectedMenuBranches}
              audioItems={audioItems}
              audioOptions={audioOptions}
              promptAudioSelected={promptAudioSelected}
              menuExtra={menuExtra}
              onConfigChange={onConfigChange}
              onConfigValueChange={onConfigValueChange}
              onMenuBranchToggle={onMenuBranchToggle}
              saveAttempted={saveAttempted}
            />
          ) : null}

          {selectedNode.data.type === 'hunt' ? (
            <HuntConfigPanel
              nodeId={selectedNode.id}
              config={selectedConfig}
              audioOptions={audioOptions}
              audioItems={audioItems}
              nodeOptions={nodeOptions}
              extensionOptions={extensionOptions}
              contactOptions={contactOptions}
              contacts={contactNumbers}
              onConfigReplace={onConfigReplace}
            />
          ) : null}

          {selectedNode.data.type === 'transfer' ? (() => {
            const transferConfig = selectedConfig as TransferNodeConfig & Record<string, unknown>;
            const targetType = transferConfig.target_type || 'extension';
            const targetValue = String(transferConfig.target_value || '');
            return (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>target type</span>
                  <SearchableSelect
                    options={transferTargetTypeOptions}
                    value={targetType}
                    onChange={(value) => {
                      const resolvedType = (value || 'extension') as TransferNodeConfig['target_type'];
                      onConfigValueChange('target_type', resolvedType);
                      onConfigValueChange('target_value', '');
                      if (resolvedType !== 'pstn') onConfigValueChange('trunk_id', undefined);
                    }}
                    placeholder="select target type"
                  />
                </label>

                {targetType === 'extension' ? (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>extension</span>
                    <SearchableSelect
                      options={extensionOptions}
                      value={targetValue || null}
                      onChange={(value) => onConfigValueChange('target_value', value || '')}
                      placeholder="select extension"
                    />
                  </label>
                ) : null}

                {targetType === 'pstn' ? (
                  <>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>pstn number</span>
                      <SearchableSelect
                        options={contactOptions}
                        value={targetValue || null}
                        onChange={(value) => {
                          onConfigValueChange('target_type', 'pstn');
                          onConfigValueChange('target_value', value || '');
                          const matchedContact = contactNumbers.find((item) => item.number === value);
                          onConfigValueChange('trunk_id', matchedContact?.trunkId ? Number(matchedContact.trunkId) : undefined);
                        }}
                        placeholder="select PSTN contact"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>trunk</span>
                      <SearchableSelect
                        options={trunkOptions}
                        value={transferConfig.trunk_id ? String(transferConfig.trunk_id) : null}
                        onChange={(value) => onConfigValueChange('trunk_id', value ? Number(value) : undefined)}
                        placeholder="select trunk"
                      />
                    </label>
                  </>
                ) : null}

                {targetType === 'sip_uri' ? (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>sip uri</span>
                    <input
                      className={styles.input}
                      placeholder="sip:john@external.com"
                      value={targetValue}
                      onChange={(event) => onConfigChange('target_value', event.target.value)}
                    />
                  </label>
                ) : null}

                {saveAttempted && !targetValue.trim() ? (
                  <span className={styles.inlineError}>Target value is required</span>
                ) : null}

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>timeout_ms</span>
                  <input
                    className={styles.input}
                    type="number"
                    value={selectedConfig.timeout_ms === null || selectedConfig.timeout_ms === undefined ? '' : String(selectedConfig.timeout_ms)}
                    onChange={(event) => onConfigChange('timeout_ms', event.target.value)}
                    placeholder="use flow default"
                  />
                  {saveAttempted && selectedConfig.timeout_ms !== null && selectedConfig.timeout_ms !== undefined && selectedConfig.timeout_ms !== '' && (Number(selectedConfig.timeout_ms) < 1000 || Number(selectedConfig.timeout_ms) > 120000) ? (
                    <span className={styles.inlineError}>Timeout must be between 1000 and 120000 ms</span>
                  ) : null}
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>WAITING_SOUND</span>
                  <SearchableSelect
                    options={audioOptions}
                    value={transferConfig.waiting_sound_id ? String(transferConfig.waiting_sound_id) : null}
                    onChange={(value) => onConfigValueChange('waiting_sound_id', value ? Number(value) : null)}
                    placeholder="None (silence)"
                  />
                </label>
                {(() => {
                  const srcPath = transferWaitingAudioItem?.previewUrl || transferWaitingAudioItem?.originalUrl;
                  return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`transfer-waiting-${transferWaitingAudioItem?.id}`} src={`${BASE}${srcPath}`} /> : null;
                })()}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>NO_ANSWER_SOUND</span>
                  <SearchableSelect
                    options={audioOptions}
                    value={transferConfig.no_answer_sound_id ? String(transferConfig.no_answer_sound_id) : null}
                    onChange={(value) => onConfigValueChange('no_answer_sound_id', value ? Number(value) : null)}
                    placeholder="None (hangup silently)"
                  />
                </label>
                {(() => {
                  const srcPath = transferNoAnswerAudioItem?.previewUrl || transferNoAnswerAudioItem?.originalUrl;
                  return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`transfer-no-answer-${transferNoAnswerAudioItem?.id}`} src={`${BASE}${srcPath}`} /> : null;
                })()}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>on_no_answer</span>
                  <SearchableSelect
                    options={nodeOptions.filter((option) => option.value !== selectedNode.id)}
                    value={selectedConfig.on_no_answer ? String(selectedConfig.on_no_answer) : null}
                    onChange={(value) => onConfigChange('on_no_answer', value || '')}
                    placeholder="select fallback node"
                  />
                </label>
              </>
            );
          })() : null}

          {selectedNode.data.type === 'business_hours' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>timezone</span>
                <input
                  className={styles.input}
                  placeholder="e.g. Asia/Colombo"
                  value={String(selectedConfig.timezone || '')}
                  onChange={(event) => onConfigChange('timezone', event.target.value)}
                />
              </label>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>weekly schedule</span>
                <div className={styles.weekGrid}>
                  {businessHoursDays.map((day) => {
                    const schedule = (selectedConfig.schedule && typeof selectedConfig.schedule === 'object'
                      ? selectedConfig.schedule
                      : {}) as Record<string, { enabled?: boolean; open?: string; close?: string }>;
                    const daySchedule = schedule[day.key] || { enabled: false, open: '09:00', close: '17:00' };
                    const enabled = Boolean(daySchedule.enabled);
                    return (
                      <div className={styles.weekRow} key={day.key}>
                        <label className={styles.dayToggle}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => {
                              onConfigValueChange('schedule', {
                                ...schedule,
                                [day.key]: { ...daySchedule, enabled: event.target.checked },
                              });
                            }}
                          />
                          <span className={styles.menuBranchLabel}>{day.label}</span>
                        </label>
                      <div className={styles.weekRowTimes}>
                        <input
                          className={styles.input}
                          disabled={!enabled}
                          type="time"
                          value={String(daySchedule.open || '09:00')}
                          onChange={(event) =>
                            onConfigValueChange('schedule', {
                              ...schedule,
                              [day.key]: { ...daySchedule, open: event.target.value },
                            })
                          }
                        />
                        <input
                          className={styles.input}
                          disabled={!enabled}
                          type="time"
                          value={String(daySchedule.close || '17:00')}
                          onChange={(event) =>
                            onConfigValueChange('schedule', {
                              ...schedule,
                              [day.key]: { ...daySchedule, close: event.target.value },
                            })
                          }
                        />
                      </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}

          {selectedNode.data.type === 'callback' ? (() => {
            const callbackConfig = selectedConfig as CallbackNodeConfig & Record<string, unknown>;
            const numberSource = callbackConfig.number_source || 'ani';
            const destinationType = callbackConfig.destination_type === 'pstn' ? 'pstn' : 'extension';
            return (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>number source</span>
                  <SearchableSelect
                    options={[
                      { value: 'ani', label: 'ANI' },
                      { value: 'dtmf', label: 'DTMF' },
                    ]}
                    value={numberSource}
                    onChange={(value) => {
                      const nextSource = value === 'dtmf' ? 'dtmf' : 'ani';
                      onConfigValueChange('number_source', nextSource);
                      if (
                        nextSource === 'dtmf'
                        && (callbackConfig.timeout_ms === null || callbackConfig.timeout_ms === undefined)
                      ) {
                        onConfigValueChange('timeout_ms', 20000);
                      }
                    }}
                    placeholder="select source"
                  />
                </label>
                {numberSource === 'dtmf' ? (
                  <>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>dtmf prompt audio</span>
                      <SearchableSelect
                        options={audioOptions}
                        value={callbackConfig.dtmf_prompt_audio_id ? String(callbackConfig.dtmf_prompt_audio_id) : null}
                        onChange={(value) => onConfigValueChange('dtmf_prompt_audio_id', value ? Number(value) : null)}
                        placeholder="optional dtmf prompt"
                      />
                    </label>
                    {(() => {
                      const srcPath = callbackDtmfPromptAudioItem?.previewUrl || callbackDtmfPromptAudioItem?.originalUrl;
                      return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`callback-dtmf-${callbackDtmfPromptAudioItem?.id}`} src={`${BASE}${srcPath}`} /> : null;
                    })()}
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>dtmf max digits</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={1}
                        max={20}
                        value={String(callbackConfig.dtmf_max_digits || 11)}
                        onChange={(event) => onConfigValueChange('dtmf_max_digits', Number.parseInt(event.target.value, 10) || 11)}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>timeout_ms</span>
                      <input
                        className={styles.input}
                        type="number"
                        min={1000}
                        max={120000}
                        step={1000}
                        value={String(callbackConfig.timeout_ms ?? 20000)}
                        onChange={(event) => onConfigValueChange('timeout_ms', event.target.value ? Number.parseInt(event.target.value, 10) : 20000)}
                      />
                      {saveAttempted && callbackConfig.timeout_ms !== null && callbackConfig.timeout_ms !== undefined && (Number(callbackConfig.timeout_ms) < 1000 || Number(callbackConfig.timeout_ms) > 120000) ? (
                        <span className={styles.inlineError}>Timeout must be between 1000 and 120000 ms</span>
                      ) : null}
                    </label>
                  </>
                ) : null}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>destination type</span>
                  <SearchableSelect
                    options={callbackDestinationTypeOptions}
                    value={destinationType}
                    onChange={(value) => {
                      const resolvedType = value === 'pstn' ? 'pstn' : 'extension';
                      onConfigValueChange('destination_type', resolvedType);
                      onConfigValueChange('destination_value', null);
                      onConfigValueChange('destination_trunk_id', null);
                      onConfigValueChange('operator_id', null);
                    }}
                    placeholder="select destination type"
                  />
                </label>
                {destinationType === 'extension' ? (
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>extension</span>
                    <SearchableSelect
                      options={extensionOptions}
                      value={callbackConfig.destination_value ? String(callbackConfig.destination_value) : null}
                      onChange={(value) => {
                        onConfigValueChange('destination_type', 'extension');
                        onConfigValueChange('destination_value', value || null);
                        onConfigValueChange('destination_trunk_id', null);
                        onConfigValueChange('operator_id', null);
                      }}
                      placeholder="select extension"
                    />
                  </label>
                ) : null}
                {destinationType === 'pstn' ? (
                  <>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>pstn number</span>
                      <SearchableSelect
                        options={contactOptions}
                        value={callbackConfig.destination_value ? String(callbackConfig.destination_value) : null}
                        onChange={(value) => {
                          onConfigValueChange('destination_type', 'pstn');
                          onConfigValueChange('destination_value', value || null);
                          const matchedContact = contactNumbers.find((item) => item.number === value);
                          onConfigValueChange('destination_trunk_id', matchedContact?.trunkId ? Number(matchedContact.trunkId) : null);
                          onConfigValueChange('operator_id', null);
                        }}
                        placeholder="select PSTN contact"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>trunk</span>
                      <SearchableSelect
                        options={trunkOptions}
                        value={callbackConfig.destination_trunk_id ? String(callbackConfig.destination_trunk_id) : null}
                        onChange={(value) => onConfigValueChange('destination_trunk_id', value ? Number(value) : null)}
                        placeholder="select trunk"
                      />
                    </label>
                  </>
                ) : null}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>confirmation audio</span>
                  <SearchableSelect
                    options={audioOptions}
                    value={callbackConfig.confirmation_audio_id ? String(callbackConfig.confirmation_audio_id) : null}
                    onChange={(value) => onConfigValueChange('confirmation_audio_id', value ? Number(value) : null)}
                    placeholder="select confirmation audio"
                  />
                  {saveAttempted && Number(callbackConfig.confirmation_audio_id || 0) <= 0 ? (
                    <span className={styles.inlineError}>Confirmation audio is required</span>
                  ) : null}
                </label>
                {(() => {
                  const srcPath = callbackConfirmationAudioItem?.previewUrl || callbackConfirmationAudioItem?.originalUrl;
                  return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`callback-confirm-${callbackConfirmationAudioItem?.id}`} src={`${BASE}${srcPath}`} /> : null;
                })()}
              </>
            );
          })() : null}

          {selectedNode.data.type === 'voicemail' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>mailbox_name</span>
                <input
                  className={styles.input}
                  placeholder="main"
                  value={String(selectedConfig.mailbox_name || 'main')}
                  onChange={(event) => onConfigChange('mailbox_name', event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>max_duration_seconds</span>
                <input
                  className={styles.input}
                  type="number"
                  value={String(selectedConfig.max_duration_seconds || 60)}
                  onChange={(event) => onConfigValueChange('max_duration_seconds', Math.max(1, Number(event.target.value) || 60))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>prompt audio</span>
                <SearchableSelect
                  options={audioOptions}
                  value={selectedConfig.prompt_audio_file_id ? String(selectedConfig.prompt_audio_file_id) : null}
                  onChange={(value) => onConfigValueChange('prompt_audio_file_id', value ? Number(value) : null)}
                  placeholder="optional voicemail prompt"
                />
              </label>
              {(() => {
                const srcPath = selectedVoicemailAudio?.previewUrl || selectedVoicemailAudio?.originalUrl;
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={selectedVoicemailAudio.id} src={`${BASE}${srcPath}`} /> : null;
              })()}
            </>
          ) : null}

          {selectedNode.data.type === 'webhook' ? (
            <WebhookConfigPanel
              config={selectedConfig}
              onConfigChange={onConfigChange}
              onConfigValueChange={onConfigValueChange}
              saveAttempted={saveAttempted}
            />
          ) : null}

          {selectedNode.data.type === 'queue_login' ? (
            <QueueLoginConfigPanel
              config={selectedConfig}
              flowDefaultTimeout={flowDefaultTimeout}
              queueItems={queueItems}
              audioItems={audioItems}
              audioOptions={audioOptions}
              onConfigValueChange={onConfigValueChange}
              saveAttempted={saveAttempted}
            />
          ) : null}

          {selectedNode.data.type === 'queue' ? (
            <QueueConfigPanel
              config={selectedConfig}
              queueItems={queueItems}
              audioItems={audioItems}
              audioOptions={audioOptions}
              onConfigValueChange={onConfigValueChange}
              saveAttempted={saveAttempted}
            />
          ) : null}

          {selectedNode.data.type === 'conference' ? (
            <ConferenceConfigPanel
              config={selectedConfig}
              extensionOptions={extensionIdOptions}
              operatorOptions={operatorOptions}
              onConfigValueChange={onConfigValueChange}
              saveAttempted={saveAttempted}
            />
          ) : null}

          <div className={styles.meta}>node key: {selectedNode.id}</div>
          <div className={styles.meta}>type: {selectedNode.data.type}</div>
        </div>
      ) : (
        <div className={pageStyles.configEmptyState}>
          <span className={pageStyles.configEmptyIcon}>
            <svg viewBox="0 0 36 36" focusable="false">
              <rect x="4" y="4" width="12" height="12" rx="2" />
              <rect x="20" y="4" width="12" height="12" rx="2" />
              <rect x="4" y="20" width="12" height="12" rx="2" />
              <rect x="20" y="20" width="12" height="12" rx="2" />
            </svg>
          </span>
          <span className={pageStyles.configEmptyLabel}>Select a node to configure it</span>
        </div>
      )}
      </div>
    </>
  );
}


interface MenuConfigProps {
  selectedNode: Node<FlowNodeData>;
  selectedConfig: Record<string, unknown>;
  selectedMenuBranches: string[];
  audioItems: AudioFileItem[];
  audioOptions: Array<{ value: string; label: string }>;
  promptAudioSelected: boolean;
  menuExtra: NodeConfigPanelMenuExtra;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  onMenuBranchToggle: (branch: string, checked: boolean) => void;
  saveAttempted?: boolean;
}

function MenuConfig({
  selectedNode,
  selectedConfig,
  selectedMenuBranches,
  audioItems,
  audioOptions,
  promptAudioSelected,
  menuExtra,
  onConfigChange,
  onMenuBranchToggle,
  saveAttempted = false,
}: MenuConfigProps) {
  const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const menuPromptItem = audioItems.find((a) => String(a.id) === String(selectedConfig.prompt_audio_file_id));
  const timeoutItem = audioItems.find((a) => String(a.id) === String(selectedConfig.timeout_prompt_audio_id));
  const invalidItem = audioItems.find((a) => String(a.id) === String(selectedConfig.invalid_prompt_audio_id));
  const failureItem = audioItems.find((a) => String(a.id) === String(selectedConfig.final_failure_audio_id));

  const { submenuNodeOptionsLoading, submenuStartNodeKey, selectedMenuLocalEdgeBranches, selectedMenuSubmenuTargets } = menuExtra;

  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>prompt audio</span>
        <SearchableSelect
          options={audioOptions}
          value={selectedConfig.prompt_audio_file_id ? String(selectedConfig.prompt_audio_file_id) : null}
          onChange={(value) => onConfigChange('prompt_audio_file_id', value || '')}
          placeholder="built-in path / manual"
        />
        {saveAttempted && Number(selectedConfig.prompt_audio_file_id || 0) <= 0 ? (
          <span className={styles.inlineError}>Prompt audio is required</span>
        ) : null}
      </label>
      {(() => {
        const srcPath = menuPromptItem?.previewUrl || menuPromptItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={menuPromptItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>prompt_path</span>
        <input
          className={styles.input}
          disabled={promptAudioSelected}
          placeholder={promptAudioSelected ? 'disabled — using audio file above' : 'built-in sound path'}
          value={promptAudioSelected ? 'disabled — using audio file above' : String(selectedConfig.prompt_path || '')}
          onChange={(event) => onConfigChange('prompt_path', event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>timeout prompt audio</span>
        <SearchableSelect
          options={audioOptions}
          value={selectedConfig.timeout_prompt_audio_id ? String(selectedConfig.timeout_prompt_audio_id) : null}
          onChange={(value) => onConfigChange('timeout_prompt_audio_id', value || '')}
          placeholder="select timeout prompt"
        />
      </label>
      {(() => {
        const srcPath = timeoutItem?.previewUrl || timeoutItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={timeoutItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>invalid prompt audio</span>
        <SearchableSelect
          options={audioOptions}
          value={selectedConfig.invalid_prompt_audio_id ? String(selectedConfig.invalid_prompt_audio_id) : null}
          onChange={(value) => onConfigChange('invalid_prompt_audio_id', value || '')}
          placeholder="select invalid prompt"
        />
      </label>
      {(() => {
        const srcPath = invalidItem?.previewUrl || invalidItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={invalidItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>final failure audio</span>
        <SearchableSelect
          options={audioOptions}
          value={selectedConfig.final_failure_audio_id ? String(selectedConfig.final_failure_audio_id) : null}
          onChange={(value) => onConfigChange('final_failure_audio_id', value || '')}
          placeholder="select goodbye prompt"
        />
      </label>
      {(() => {
        const srcPath = failureItem?.previewUrl || failureItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={failureItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>timeout_ms</span>
        <input
          className={styles.input}
          type="number"
          value={selectedConfig.timeout_ms === null || selectedConfig.timeout_ms === undefined ? '' : String(selectedConfig.timeout_ms)}
          onChange={(event) => onConfigChange('timeout_ms', event.target.value)}
          placeholder="use flow default"
        />
        {saveAttempted && selectedConfig.timeout_ms !== null && selectedConfig.timeout_ms !== undefined && selectedConfig.timeout_ms !== '' && (Number(selectedConfig.timeout_ms) < 1000 || Number(selectedConfig.timeout_ms) > 120000) ? (
          <span className={styles.inlineError}>Timeout must be between 1000 and 120000 ms</span>
        ) : null}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>max timeout attempts</span>
        <input
          className={styles.input}
          type="number"
          value={String(selectedConfig.max_timeout_attempts || 3)}
          onChange={(event) => onConfigChange('max_timeout_attempts', event.target.value)}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>max invalid attempts</span>
        <input
          className={styles.input}
          type="number"
          value={String(selectedConfig.max_invalid_attempts || 3)}
          onChange={(event) => onConfigChange('max_invalid_attempts', event.target.value)}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>branches</span>
        <div className={styles.menuBranchList}>
          {menuBranchOptions.map((branch) => {
            const checked = selectedMenuBranches.includes(branch);
            return (
              <div className={styles.menuBranchGroup} key={branch}>
                <label className={styles.menuBranchOption}>
                  <input
                    checked={checked}
                    onChange={(event) => onMenuBranchToggle(branch, event.target.checked)}
                    type="checkbox"
                  />
                  <span className={styles.menuBranchLabel}>{branch}</span>
                </label>
              </div>
            );
          })}
        </div>
        {saveAttempted && selectedMenuBranches.length === 0 ? (
          <span className={styles.inlineError}>At least one branch is required</span>
        ) : null}
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>submenu branch targets</span>
        {selectedNode.data.subflowId ? (
          <div className={styles.menuBranchList}>
            {selectedMenuBranches.map((branch) => (
              <div className={styles.menuBranchGroup} key={`submenu-target-${branch}`}>
                <span className={styles.menuBranchLabel}>{branch}</span>
                <div className={styles.meta}>
                  {selectedMenuLocalEdgeBranches.has(branch)
                    ? 'disabled — routed by local edge'
                    : submenuNodeOptionsLoading
                    ? 'loading submenu start...'
                    : `auto: ${selectedMenuSubmenuTargets[branch] || submenuStartNodeKey || 'start'}`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.meta}>Save flow once to create submenu, then map branches here.</div>
        )}
      </div>
      <div className={styles.meta}>subflow: {selectedNode.data.subflowId ? `#${selectedNode.data.subflowId}` : 'created on save'}</div>
    </>
  );
}

interface WebhookConfigPanelProps {
  config: Record<string, unknown>;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  saveAttempted?: boolean;
}

function WebhookConfigPanel({ config, onConfigChange, onConfigValueChange, saveAttempted }: WebhookConfigPanelProps) {
  const headers = Array.isArray(config['headers'])
    ? (config['headers'] as Array<{ key: string; value: string }>)
    : [];

  const addHeader = () => onConfigValueChange('headers', [...headers, { key: '', value: '' }]);

  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const next = headers.map((h, i) => i === index ? { ...h, [field]: val } : h);
    onConfigValueChange('headers', next);
  };

  const removeHeader = (index: number) => {
    onConfigValueChange('headers', headers.filter((_, i) => i !== index));
  };

  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>url</span>
        <input
          className={styles.input}
          placeholder="https://example.com/webhook"
          value={String(config['url'] || '')}
          onChange={(e) => onConfigChange('url', e.target.value)}
        />
        {saveAttempted && !String(config['url'] || '').trim() ? (
          <span className={styles.inlineError}>URL is required</span>
        ) : null}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>method</span>
        <select
          className={styles.input}
          value={String(config['method'] || 'POST')}
          onChange={(e) => onConfigChange('method', e.target.value)}
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>timeout_ms</span>
        <input
          className={styles.input}
          type="number"
          value={config['timeout_ms'] === null || config['timeout_ms'] === undefined ? '' : String(config['timeout_ms'])}
          onChange={(e) => onConfigChange('timeout_ms', e.target.value)}
          placeholder="use flow default"
        />
      </label>
      <label className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={Boolean(config['include_caller'])}
          onChange={(e) => onConfigValueChange('include_caller', e.target.checked)}
        />
        <span className={styles.fieldLabel} style={{ textTransform: 'none', letterSpacing: 0 }}>include caller number</span>
      </label>
      <label className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={Boolean(config['include_digits'])}
          onChange={(e) => onConfigValueChange('include_digits', e.target.checked)}
        />
        <span className={styles.fieldLabel} style={{ textTransform: 'none', letterSpacing: 0 }}>include session variables</span>
      </label>
      <div className={styles.field} style={{ width: '100%', overflow: 'hidden' }}>
        <span className={styles.fieldLabel}>headers</span>
        {headers.map((header, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, width: '100%', overflow: 'hidden', marginTop: 4 }}>
            <input
              className={styles.input}
              placeholder="Header-Name"
              value={header.key}
              onChange={(e) => updateHeader(i, 'key', e.target.value)}
              style={{ flex: '1 1 0', minWidth: 0 }}
            />
            <input
              className={styles.input}
              placeholder="value"
              value={header.value}
              onChange={(e) => updateHeader(i, 'value', e.target.value)}
              style={{ flex: '1 1 0', minWidth: 0 }}
            />
            <button
              type="button"
              className={styles.input}
              style={{ flex: '0 0 auto', width: 28, padding: 0, cursor: 'pointer', color: 'var(--color-error)' }}
              onClick={() => removeHeader(i)}
            >×</button>
          </div>
        ))}
        <button
          type="button"
          className={styles.input}
          onClick={addHeader}
          style={{ marginTop: 6, cursor: 'pointer', color: 'var(--text-secondary)', width: 'auto', padding: '0 10px' }}
        >
          + add header
        </button>
      </div>
    </>
  );
}

interface QueueLoginConfigPanelProps {
  config: Record<string, unknown>;
  flowDefaultTimeout: number;
  queueItems?: import('../../types').QueueItem[];
  audioItems: AudioFileItem[];
  audioOptions: Array<{ value: string; label: string }>;
  onConfigValueChange: (field: string, value: unknown) => void;
  saveAttempted?: boolean;
}

function QueueLoginConfigPanel({ config, flowDefaultTimeout, queueItems, audioItems, audioOptions, onConfigValueChange, saveAttempted }: QueueLoginConfigPanelProps) {
  const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const queueOptions = (queueItems ?? []).map((q) => ({ value: String(q.id), label: q.name }));
  const useFlowDefaultTimeout = config['use_flow_default_timeout'] !== false;
  const promptItem = audioItems.find((a) => String(a.id) === String(config['prompt_audio_file_id']));
  const wrongPinItem = audioItems.find((a) => String(a.id) === String(config['wrong_pin_audio_file_id']));
  const successItem = audioItems.find((a) => String(a.id) === String(config['login_success_audio_file_id']));
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>queue</span>
        <SearchableSelect
          options={queueOptions}
          value={config['queue_id'] ? String(config['queue_id']) : null}
          onChange={(value) => onConfigValueChange('queue_id', value ? Number(value) : null)}
          placeholder="select queue"
        />
        {saveAttempted && !config['queue_id'] ? (
          <span className={styles.inlineError}>Queue is required</span>
        ) : null}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>input timeout mode</span>
        <select
          className={styles.input}
          value={useFlowDefaultTimeout ? 'flow_default' : 'custom'}
          onChange={(event) => onConfigValueChange('use_flow_default_timeout', event.target.value === 'flow_default')}
        >
          <option value="flow_default">use flow default</option>
          <option value="custom">custom timeout</option>
        </select>
      </label>
      {useFlowDefaultTimeout ? (
        <div className={styles.meta}>Effective timeout: {flowDefaultTimeout} ms (from start node default).</div>
      ) : (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>input timeout (ms)</span>
          <input
            className={styles.input}
            type="number"
            min={1000}
            max={120000}
            value={String(config['input_timeout_ms'] || '')}
            onChange={(event) => onConfigValueChange('input_timeout_ms', event.target.value ? Number(event.target.value) : null)}
            placeholder="10000"
          />
          {saveAttempted && (Number(config['input_timeout_ms'] || 0) < 1000 || Number(config['input_timeout_ms'] || 0) > 120000) ? (
            <span className={styles.inlineError}>Custom input timeout must be between 1000 and 120000 ms</span>
          ) : null}
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>prompt audio</span>
        <SearchableSelect
          options={audioOptions}
          value={config['prompt_audio_file_id'] ? String(config['prompt_audio_file_id']) : null}
          onChange={(value) => onConfigValueChange('prompt_audio_file_id', value ? Number(value) : null)}
          placeholder="optional — enter PIN prompt"
        />
      </label>
      {(() => {
        const srcPath = promptItem?.previewUrl || promptItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={promptItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>wrong PIN audio</span>
        <SearchableSelect
          options={audioOptions}
          value={config['wrong_pin_audio_file_id'] ? String(config['wrong_pin_audio_file_id']) : null}
          onChange={(value) => onConfigValueChange('wrong_pin_audio_file_id', value ? Number(value) : null)}
          placeholder="optional — wrong PIN prompt"
        />
      </label>
      {(() => {
        const srcPath = wrongPinItem?.previewUrl || wrongPinItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={wrongPinItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>success audio</span>
        <SearchableSelect
          options={audioOptions}
          value={config['login_success_audio_file_id'] ? String(config['login_success_audio_file_id']) : null}
          onChange={(value) => onConfigValueChange('login_success_audio_file_id', value ? Number(value) : null)}
          placeholder="optional — logged in confirmation"
        />
      </label>
      {(() => {
        const srcPath = successItem?.previewUrl || successItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={successItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
    </>
  );
}

interface QueueConfigPanelProps {
  config: Record<string, unknown>;
  queueItems?: import('../../types').QueueItem[];
  audioItems: AudioFileItem[];
  audioOptions: Array<{ value: string; label: string }>;
  onConfigValueChange: (field: string, value: unknown) => void;
  saveAttempted?: boolean;
}

function QueueConfigPanel({ config, queueItems, audioItems, audioOptions, onConfigValueChange, saveAttempted }: QueueConfigPanelProps) {
 const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
 const queueOptions = (queueItems ?? []).map((q) => ({ value: String(q.id), label: q.name }));
 const promptItem = audioItems.find((a) => String(a.id) === String(config['prompt_audio_file_id']));
  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>queue</span>
        <SearchableSelect
          options={queueOptions}
          value={config['queue_id'] ? String(config['queue_id']) : null}
          onChange={(value) => onConfigValueChange('queue_id', value ? Number(value) : null)}
          placeholder="select queue"
        />
        {saveAttempted && !config['queue_id'] ? (
          <span className={styles.inlineError}>Queue is required</span>
        ) : null}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>prompt audio</span>
        <SearchableSelect
          options={audioOptions}
          value={config['prompt_audio_file_id'] ? String(config['prompt_audio_file_id']) : null}
          onChange={(value) => onConfigValueChange('prompt_audio_file_id', value ? Number(value) : null)}
          placeholder="optional — queue entry prompt"
        />
      </label>
      {(() => {
        const srcPath = promptItem?.previewUrl || promptItem?.originalUrl;
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={promptItem?.id} src={`${BASE}${srcPath}`} /> : null;
      })()}
    </>
  );
}

interface ConferenceConfigPanelProps {
  config: Record<string, unknown>;
  extensionOptions: Array<{ value: string; label: string }>;
  operatorOptions: Array<{ value: string; label: string }>;
  onConfigValueChange: (field: string, value: unknown) => void;
  saveAttempted?: boolean;
}

function ConferenceConfigPanel({ config, extensionOptions, operatorOptions, onConfigValueChange, saveAttempted }: ConferenceConfigPanelProps) {
  const conferenceConfig = config as ConferenceNodeConfig & Record<string, unknown>;
  const roomName = String(conferenceConfig.roomName || '');
  const waitForModerator = Boolean(conferenceConfig.waitForModerator);
  const moderatorType = conferenceConfig.moderatorType === 'pstn' ? 'pstn' : 'extension';
  const moderatorTypeOptions = [
    { value: 'extension', label: 'Extension' },
    { value: 'pstn', label: 'PSTN Operator' },
  ];

  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>room name</span>
        <input
          className={styles.input}
          placeholder="SalesRoom1"
          value={roomName}
          onChange={(event) => onConfigValueChange('roomName', event.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
        />
        {saveAttempted && !roomName.trim() ? (
          <span className={styles.inlineError}>Room name is required</span>
        ) : null}
      </label>

      <label className={styles.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={waitForModerator}
          onChange={(event) => {
            onConfigValueChange('waitForModerator', event.target.checked);
            if (!event.target.checked) {
              onConfigValueChange('moderatorType', null);
              onConfigValueChange('moderatorId', null);
            } else if (!conferenceConfig.moderatorType) {
              onConfigValueChange('moderatorType', 'extension');
            }
          }}
        />
        <span className={styles.fieldLabel} style={{ textTransform: 'none', letterSpacing: 0 }}>wait for moderator</span>
      </label>

      {waitForModerator ? (
        <>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>moderator type</span>
            <SearchableSelect
              options={moderatorTypeOptions}
              value={moderatorType}
              onChange={(value) => {
                const resolvedType = value === 'pstn' ? 'pstn' : 'extension';
                onConfigValueChange('moderatorType', resolvedType);
                onConfigValueChange('moderatorId', null);
              }}
              placeholder="select moderator type"
            />
          </label>

          {moderatorType === 'extension' ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>extension</span>
              <SearchableSelect
                options={extensionOptions}
                value={conferenceConfig.moderatorId ? String(conferenceConfig.moderatorId) : null}
                onChange={(value) => {
                  onConfigValueChange('moderatorType', 'extension');
                  onConfigValueChange('moderatorId', value ? Number(value) : null);
                }}
                placeholder="select extension"
              />
              {saveAttempted && !conferenceConfig.moderatorId ? (
                <span className={styles.inlineError}>Moderator is required</span>
              ) : null}
            </label>
          ) : null}

          {moderatorType === 'pstn' ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>pstn operator</span>
              <SearchableSelect
                options={operatorOptions}
                value={conferenceConfig.moderatorId ? String(conferenceConfig.moderatorId) : null}
                onChange={(value) => {
                  onConfigValueChange('moderatorType', 'pstn');
                  onConfigValueChange('moderatorId', value ? Number(value) : null);
                }}
                placeholder="select PSTN operator"
              />
              {saveAttempted && !conferenceConfig.moderatorId ? (
                <span className={styles.inlineError}>Moderator is required</span>
              ) : null}
            </label>
          ) : null}
        </>
      ) : null}
    </>
  );
}
