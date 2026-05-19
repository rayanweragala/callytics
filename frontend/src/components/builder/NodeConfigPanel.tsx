import { useEffect, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { AudioFileItem, BuilderNodeType, CallbackNodeConfig, ConferenceNodeConfig, ContactNumber, ExtensionItem, FlowNodeData, OperatorItem, QueueItem, SipTrunkItem, TransferNodeConfig, WebhookNodeConfig } from '../../types';
import { getWebhookNodeDeliveries } from '../../lib/api';
import { getMediaBaseUrl } from '../../lib/backendBaseUrl';
import { formatDateTime } from '../../lib/time';
import { SearchableSelect } from '../common/SearchableSelect';
import { AudioPreviewPlayer } from '../audio/AudioPreviewPlayer';
import { HuntConfigPanel } from '../panels/HuntConfigPanel';
import styles from './NodeConfigPanel.module.css';
import pageStyles from '../../pages/FlowEditorPage.module.css';
import {
  conditionValues,
  sanitizeMenuBranchFlows,
  sanitizeMenuBranchNames,
  isValidDigitConditionValue,
  isValidMenuBranchValue,
  sanitizeMenuBranches,
} from '../../pages/FlowEditorPage.helpers';

type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
  isSubflowJump?: boolean;
  onDelete?: (edgeId: string) => void;
};

const businessHoursDays: Array<{ key: string; label: string }> = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];
const quickMenuBranchOptions = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];
const MEDIA_BASE = getMediaBaseUrl();

export interface NodeConfigPanelMenuExtra {
  selectedMenuLocalEdgeBranches: Set<string>;
  selectedMenuBranchFlows: Record<string, { flowId: number; name: string }>;
}

export interface NodeConfigPanelProps {
  selectedNode: Node<FlowNodeData> | null;
  selectedEdge: Edge<BuilderEdgeData> | null;
  selectedEdgeSourceNode: Node<FlowNodeData> | null;
  audioItems: AudioFileItem[];
  nodes: Array<Node<FlowNodeData>>;
  edges?: Array<Edge<BuilderEdgeData>>;
  onLabelChange: (value: string) => void;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  onConfigReplace: (nextConfig: Record<string, unknown>) => void;
  onEdgeConditionChange: (value: string | null) => void;
  onMenuBranchToggle: (branch: string, checked: boolean) => void;
  onOpenSubmenuAction?: (nodeId: string, branch?: string) => void;
  onRenameSubmenu?: (flowId: number, name: string) => void | Promise<void>;
  
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
  edges = [],
  onLabelChange,
  onConfigChange,
  onConfigValueChange,
  onConfigReplace,
  onEdgeConditionChange,
  onMenuBranchToggle,
  onOpenSubmenuAction,
  onRenameSubmenu,
  menuExtra,
  flowDefaultTimeout = 10000,
  queueItems,
  extensions = [],
  operators = [],
  contactNumbers = [],
  trunks = [],
  saveAttempted = false,
}: NodeConfigPanelProps) {
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
  const selectedVoicemailIntroAudio = selectedConfig.start_audio_id
    ? audioItems.find((item) => item.id === Number(selectedConfig.start_audio_id))
    : null;
  const selectedVoicemailOutroAudio = selectedConfig.end_audio_id
    ? audioItems.find((item) => item.id === Number(selectedConfig.end_audio_id))
    : null;
  const selectedNodeHasOutgoingWebhook = Boolean(selectedNode && edges.some((edge) => {
    if (edge.source !== selectedNode.id) {
      return false;
    }
    return nodes.find((node) => node.id === edge.target)?.data.type === 'webhook';
  }));

  const playAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.audio_file_id));
  const getDigitsAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.prompt_audio_file_id));
  const transferWaitingAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.waiting_sound_id));
  const transferNoAnswerAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.no_answer_sound_id));
  const callbackDtmfPromptAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.dtmf_prompt_audio_id));
  const callbackConfirmationAudioItem = audioItems.find((a) => String(a.id) === String(selectedConfig.confirmation_audio_id));
  const selectionRenderKey = selectedNode
    ? `node:${selectedNode.id}`
    : selectedEdge
    ? `edge:${selectedEdge.id}`
    : 'empty';

  const edgeConditionOptions = (() => {
    if (!selectedEdge || !selectedEdgeSourceNode) return [] as Array<{ value: string; label: string }>;
    if (selectedEdgeSourceNode.data.type === 'menu') {
      const menuBranches = sanitizeMenuBranches(selectedEdgeSourceNode.data.config.branches);
      return menuBranches.map((value) => ({ value, label: value }));
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
      <div className={pageStyles.configScrollArea} key={selectionRenderKey}>
        {selectedEdge ? (
          <div className={styles.form}>
          {selectedEdgeSourceNode &&
          (selectedEdgeSourceNode.data.type === 'get_digits' || selectedEdgeSourceNode.data.type === 'menu') ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>condition</span>
              <input
                className={styles.input}
                list={selectedEdgeSourceNode.data.type === 'get_digits' ? 'get-digits-condition-options' : 'menu-condition-options'}
                value={selectedEdge.data?.condition || selectedEdge.data?.branchKey || ''}
                onChange={(event) => onEdgeConditionChange(event.target.value || null)}
                placeholder={selectedEdgeSourceNode.data.type === 'get_digits' ? '1, 16, *, #, timeout, invalid' : '1, 16, *, #'}
              />
              {selectedEdgeSourceNode.data.type === 'get_digits' ? (
                <datalist id="get-digits-condition-options">
                  {edgeConditionOptions.map((option) => <option key={option.value} value={option.value} />)}
                </datalist>
              ) : (
                <datalist id="menu-condition-options">
                  {edgeConditionOptions.map((option) => <option key={option.value} value={option.value} />)}
                </datalist>
              )}
              {!(
                selectedEdgeSourceNode.data.type === 'menu'
                  ? (String(selectedEdge.data?.condition || selectedEdge.data?.branchKey || '') === 'complete'
                    || isValidMenuBranchValue(String(selectedEdge.data?.condition || selectedEdge.data?.branchKey || '')))
                  : isValidDigitConditionValue(String(selectedEdge.data?.condition || selectedEdge.data?.branchKey || ''))
              ) ? (
                <span className={styles.inlineError}>
                  {selectedEdgeSourceNode.data.type === 'get_digits'
                    ? 'Use 1-2 digits, *, #, timeout, invalid, or default'
                    : 'Use 1-2 digits, *, or #'}
                </span>
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
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={playAudioItem.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
                <span className={styles.fieldLabel}>variable name</span>
                <input
                  className={styles.input}
                  value={String(selectedConfig.variable_name || '')}
                  onChange={(event) => onConfigChange('variable_name', event.target.value)}
                  placeholder="captured_digits"
                />
                {saveAttempted && !String(selectedConfig.variable_name || '').trim() ? (
                  <span className={styles.inlineError}>Variable name is required</span>
                ) : null}
              </label>
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
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={getDigitsAudioItem.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
                {saveAttempted
                && selectedConfig.timeout_ms !== null
                && selectedConfig.timeout_ms !== undefined
                && selectedConfig.timeout_ms !== ''
                && (Number(selectedConfig.timeout_ms) < 1000 || Number(selectedConfig.timeout_ms) > 120000) ? (
                  <span className={styles.inlineError}>Timeout must be between 1000 and 120000 ms</span>
                ) : null}
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
              nodes={nodes}
              edges={edges}
              onConfigChange={onConfigChange}
              onConfigValueChange={onConfigValueChange}
            onMenuBranchToggle={onMenuBranchToggle}
            onOpenSubmenuAction={onOpenSubmenuAction}
            onRenameSubmenu={onRenameSubmenu}
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
              hasOutgoingWebhook={selectedNodeHasOutgoingWebhook}
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
                      onChange={(value) => {
                        onConfigValueChange('target_type', 'extension');
                        onConfigValueChange('target_value', value || '');
                      }}
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
                      onChange={(event) => {
                        onConfigValueChange('target_type', 'sip_uri');
                        onConfigChange('target_value', event.target.value);
                      }}
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
                    placeholder="MOH"
                  />
                </label>
                {(() => {
                  const srcPath = transferWaitingAudioItem?.previewUrl || transferWaitingAudioItem?.originalUrl;
                  return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`transfer-waiting-${transferWaitingAudioItem?.id}`} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
                  return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`transfer-no-answer-${transferNoAnswerAudioItem?.id}`} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
                <div className={styles.toggleField}>
                  <span className={styles.toggleLabel}>Record call</span>
                  <button
                    aria-checked={Boolean(transferConfig.record_call)}
                    aria-label="Record call"
                    className={`${styles.toggleSwitch} ${Boolean(transferConfig.record_call) ? styles.toggleOn : ''}`}
                    onClick={() => onConfigValueChange('record_call', !Boolean(transferConfig.record_call))}
                    role="switch"
                    type="button"
                  >
                    <span />
                  </button>
                </div>
                <span className={styles.meta}>Records the conversation after the call is transferred.</span>
                {Boolean(transferConfig.record_call) ? (
                  <>
                    <label className={`${styles.field} ${styles.fieldRow}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(transferConfig.send_to_webhook)}
                        onChange={(event) => onConfigValueChange('send_to_webhook', event.target.checked)}
                      />
                      <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>
                        Send recording with webhook request
                      </span>
                    </label>
                    {Boolean(transferConfig.send_to_webhook) && !selectedNodeHasOutgoingWebhook ? (
                      <span className={styles.inlineWarning}>Connect a Webhook node to receive the recording.</span>
                    ) : null}
                  </>
                ) : null}
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
                      return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`callback-dtmf-${callbackDtmfPromptAudioItem?.id}`} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
                    {saveAttempted && !String(callbackConfig.destination_value || '').trim() ? (
                      <span className={styles.inlineError}>Destination is required</span>
                    ) : null}
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
                      {saveAttempted && !String(callbackConfig.destination_value || '').trim() ? (
                        <span className={styles.inlineError}>Destination is required</span>
                      ) : null}
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
                    placeholder="optional confirmation audio"
                  />
                </label>
                {(() => {
                  const srcPath = callbackConfirmationAudioItem?.previewUrl || callbackConfirmationAudioItem?.originalUrl;
                  return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={`callback-confirm-${callbackConfirmationAudioItem?.id}`} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
                <span className={styles.fieldLabel}>intro message</span>
                <SearchableSelect
                  options={audioOptions}
                  value={selectedConfig.start_audio_id ? String(selectedConfig.start_audio_id) : null}
                  onChange={(value) => onConfigValueChange('start_audio_id', value ? Number(value) : null)}
                  placeholder="select intro message"
                />
                <span className={styles.meta}>Played to the caller before the beep. Example: 'Please leave a message after the tone.'</span>
                {saveAttempted && Number(selectedConfig.start_audio_id || 0) <= 0 ? (
                  <span className={styles.inlineError}>Intro message is required</span>
                ) : null}
              </label>
              {(() => {
                const srcPath = selectedVoicemailIntroAudio?.previewUrl || selectedVoicemailIntroAudio?.originalUrl;
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={selectedVoicemailIntroAudio.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
              })()}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>outro message</span>
                <SearchableSelect
                  options={audioOptions}
                  value={selectedConfig.end_audio_id ? String(selectedConfig.end_audio_id) : null}
                  onChange={(value) => onConfigValueChange('end_audio_id', value ? Number(value) : null)}
                  placeholder="optional outro message"
                />
                <span className={styles.meta}>Played after the recording ends. If not set, the call hangs up silently.</span>
              </label>
              {(() => {
                const srcPath = selectedVoicemailOutroAudio?.previewUrl || selectedVoicemailOutroAudio?.originalUrl;
                return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={selectedVoicemailOutroAudio.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
              })()}
              <label className={`${styles.field} ${styles.fieldRow}`}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedConfig.send_to_webhook)}
                  onChange={(event) => onConfigValueChange('send_to_webhook', event.target.checked)}
                />
                <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>
                  Send recording with webhook request
                </span>
              </label>
              {Boolean(selectedConfig.send_to_webhook) && !selectedNodeHasOutgoingWebhook ? (
                <span className={styles.inlineWarning}>Connect a Webhook node to receive the recording.</span>
              ) : null}
            </>
          ) : null}

          {selectedNode.data.type === 'webhook' ? (
            <WebhookConfigPanel
              nodeId={selectedNode.id}
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
  nodes: Array<Node<FlowNodeData>>;
  edges: Array<Edge<BuilderEdgeData>>;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  onMenuBranchToggle: (branch: string, checked: boolean) => void;
  onOpenSubmenuAction?: (nodeId: string, branch?: string) => void;
  onRenameSubmenu?: (flowId: number, name: string) => void | Promise<void>;
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
  nodes,
  edges,
  onConfigChange,
  onConfigValueChange,
  onMenuBranchToggle,
  onOpenSubmenuAction,
  onRenameSubmenu,
  saveAttempted = false,
}: MenuConfigProps) {
  const [branchDraft, setBranchDraft] = useState('');
  const menuPromptItem = audioItems.find((a) => String(a.id) === String(selectedConfig.prompt_audio_file_id));
  const timeoutItem = audioItems.find((a) => String(a.id) === String(selectedConfig.timeout_prompt_audio_id));
  const invalidItem = audioItems.find((a) => String(a.id) === String(selectedConfig.invalid_prompt_audio_id));
  const { selectedMenuLocalEdgeBranches, selectedMenuBranchFlows } = menuExtra;
  const selectedMenuBranchNames = sanitizeMenuBranchNames(selectedConfig.submenu_branch_names);
  const [renamingBranch, setRenamingBranch] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const activeRenamedSubmenuName = renamingBranch ? selectedMenuBranchFlows[renamingBranch]?.name || '' : '';

  useEffect(() => {
    if (!renamingBranch) {
      setRenameDraft('');
      return;
    }
    setRenameDraft(activeRenamedSubmenuName);
  }, [renamingBranch, activeRenamedSubmenuName]);

  const updateBranchNames = (nextBranchNames: Record<string, string>) => {
    onConfigValueChange('submenu_branch_names', nextBranchNames);
  };

  const submitSubmenuRename = async (branch: string, flowId: number) => {
    const nextName = renameDraft.trim();
    if (!nextName) {
      setRenameDraft(selectedMenuBranchFlows[branch]?.name || '');
      setRenamingBranch(null);
      return;
    }
    if (nextName !== selectedMenuBranchFlows[branch]?.name) {
      await onRenameSubmenu?.(flowId, nextName);
    }
    setRenamingBranch(null);
  };
  const localRouteLabels = selectedMenuBranches.reduce<Record<string, string>>((acc, branch) => {
    const matchingEdge = edges.find((edge) => {
      if (edge.source !== selectedNode.id) return false;
      const resolved = String(edge.data?.condition || edge.data?.branchKey || '').trim();
      return resolved === branch;
    });
    if (!matchingEdge) return acc;
    const targetNode = nodes.find((node) => node.id === matchingEdge.target);
    acc[branch] = targetNode ? targetNode.data.label || targetNode.id : matchingEdge.target;
    return acc;
  }, {});
  const addMenuBranch = (rawValue: string) => {
    const nextValue = rawValue.trim();
    if (!isValidMenuBranchValue(nextValue) || selectedMenuBranches.includes(nextValue)) {
      return;
    }
    onConfigValueChange('branches', [...selectedMenuBranches, nextValue]);
    setBranchDraft('');
  };
  const removeMenuBranch = (branch: string) => onMenuBranchToggle(branch, false);

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
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={menuPromptItem?.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={timeoutItem?.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={invalidItem?.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
          {selectedMenuBranches.map((branch) => (
            <div className={styles.menuBranchGroup} key={branch}>
              <span className={styles.menuBranchLabel}>{branch}</span>
              <button type="button" className={`${styles.input} ${styles.iconButton}`} onClick={() => removeMenuBranch(branch)}>×</button>
            </div>
          ))}
        </div>
        <div className={styles.menuBranchList}>
          {quickMenuBranchOptions.map((branch) => (
            <button
              key={`quick-${branch}`}
              type="button"
              className={`${styles.input} ${styles.inlineButtonAuto}`}
              style={{ opacity: selectedMenuBranches.includes(branch) ? 0.5 : 1 }}
              onClick={() => addMenuBranch(branch)}
            >
              + {branch}
            </button>
          ))}
        </div>
        <div className={styles.branchDraftRow}>
          <input
            className={styles.input}
            value={branchDraft}
            onChange={(event) => setBranchDraft(event.target.value)}
            placeholder="add 1-2 digit branch"
          />
          <button type="button" className={`${styles.input} ${styles.inlineButtonAuto}`} onClick={() => addMenuBranch(branchDraft)}>
            add
          </button>
        </div>
        {branchDraft.trim() && !isValidMenuBranchValue(branchDraft.trim()) ? (
          <span className={styles.inlineError}>Use 1-2 digits, *, or #</span>
        ) : null}
        {saveAttempted && selectedMenuBranches.length === 0 ? (
          <span className={styles.inlineError}>At least one branch is required</span>
        ) : null}
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>branch routing</span>
        <div className={styles.routeList}>
          {selectedMenuBranches.map((branch) => {
            const hasLocalRoute = selectedMenuLocalEdgeBranches.has(branch);
            const submenuFlow = selectedMenuBranchFlows[branch];
            const routeType = hasLocalRoute
              ? 'main flow'
              : submenuFlow
              ? 'submenu'
              : 'unrouted';
            const routeDetail = hasLocalRoute
              ? localRouteLabels[branch] || 'connected node'
              : submenuFlow
              ? submenuFlow.name
              : 'create submenu or draw a local edge';
            const toneClass =
              routeType === 'submenu'
                ? styles.routeToneSubmenu
                : routeType === 'main flow'
                ? styles.routeToneMain
                : styles.routeToneMissing;

            return (
              <div className={styles.routeRow} key={`route-${branch}`}>
                <span className={styles.menuBranchLabel}>{branch}</span>
                <span className={`${styles.routeBadge} ${toneClass}`}>{routeType}</span>
                <div className={styles.routeDetail}>{routeDetail}</div>
                {hasLocalRoute ? null : submenuFlow ? (
                  <div className={styles.submenuNameRow}>
                    <button
                      type="button"
                      className={`${styles.input} ${styles.inlineButtonAuto}`}
                      onClick={() => onOpenSubmenuAction?.(selectedNode.id, branch)}
                    >
                      Open submenu
                    </button>
                    {renamingBranch === branch ? (
                      <input
                        autoFocus
                        className={styles.input}
                        value={renameDraft}
                        onBlur={() => void submitSubmenuRename(branch, submenuFlow.flowId)}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void submitSubmenuRename(branch, submenuFlow.flowId);
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setRenameDraft(submenuFlow.name);
                            setRenamingBranch(null);
                          }
                        }}
                      />
                    ) : (
                      <button
                        aria-label={`Rename submenu ${branch}`}
                        className={`${styles.input} ${styles.iconButton}`}
                        onClick={() => {
                          setRenameDraft(submenuFlow.name);
                          setRenamingBranch(branch);
                        }}
                        type="button"
                      >
                        ✎
                      </button>
                    )}
                  </div>
                ) : (
                  <div className={styles.branchDraftRow}>
                    <input
                      className={styles.input}
                      placeholder={`${selectedNode.data.label || 'Menu'} ${branch} submenu`}
                      value={selectedMenuBranchNames[branch] || ''}
                      onChange={(event) => updateBranchNames({ ...selectedMenuBranchNames, [branch]: event.target.value })}
                    />
                    <button
                      type="button"
                      className={`${styles.input} ${styles.inlineButtonAuto}`}
                      onClick={() => onOpenSubmenuAction?.(selectedNode.id, branch)}
                    >
                      Create submenu
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {selectedMenuBranches.length === 0 ? (
          <div className={styles.meta}>Add branches first, then route each branch to the main flow or submenu.</div>
        ) : null}
      </div>
    </>
  );
}

interface WebhookConfigPanelProps {
  nodeId: string;
  config: Partial<WebhookNodeConfig> & Record<string, unknown>;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  saveAttempted?: boolean;
}

function WebhookConfigPanel({ nodeId, config, onConfigChange, onConfigValueChange, saveAttempted }: WebhookConfigPanelProps) {
  const headers = Array.isArray(config['headers'])
    ? (config['headers'] as Array<{ key: string; value: string }>)
    : [];
  const retryEnabled = config['retry_enabled'] !== false;
  const rawMaxAttempts = typeof config['max_attempts'] === 'number'
    ? config['max_attempts']
    : Number(config['max_attempts']);
  const maxAttempts = Number.isFinite(rawMaxAttempts) && rawMaxAttempts >= 1 && rawMaxAttempts <= 5
    ? rawMaxAttempts
    : 3;
  const [recentDeliveries, setRecentDeliveries] = useState<Array<{
    id: string;
    createdAt: string;
    success: boolean;
    attemptNumber: number;
  }>>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);

  const addHeader = () => onConfigValueChange('headers', [...headers, { key: '', value: '' }]);

  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const next = headers.map((h, i) => i === index ? { ...h, [field]: val } : h);
    onConfigValueChange('headers', next);
  };

  const removeHeader = (index: number) => {
    onConfigValueChange('headers', headers.filter((_, i) => i !== index));
  };

  useEffect(() => {
    let active = true;

    const loadRecentDeliveries = async () => {
      if (!nodeId) {
        setRecentDeliveries([]);
        return;
      }

      setDeliveriesLoading(true);
      setDeliveriesError(null);
      try {
        const response = await getWebhookNodeDeliveries(nodeId);
        if (!active) {
          return;
        }
        setRecentDeliveries(
          response.data.slice(0, 5).map((item) => ({
            id: item.id,
            createdAt: item.createdAt,
            success: item.success,
            attemptNumber: item.attemptNumber,
          })),
        );
      } catch {
        if (!active) {
          return;
        }
        setDeliveriesError('Failed to load recent deliveries');
      } finally {
        if (active) {
          setDeliveriesLoading(false);
        }
      }
    };

    void loadRecentDeliveries();

    return () => {
      active = false;
    };
  }, [nodeId]);

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
      <label className={`${styles.field} ${styles.fieldRow}`}>
        <input
          type="checkbox"
          checked={Boolean(config['include_caller'])}
          onChange={(e) => onConfigValueChange('include_caller', e.target.checked)}
        />
        <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>include caller number</span>
      </label>
      <label className={`${styles.field} ${styles.fieldRow}`}>
        <input
          type="checkbox"
          checked={Boolean(config['include_session_variables'])}
          onChange={(e) => onConfigValueChange('include_session_variables', e.target.checked)}
        />
        <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>Include collected variables</span>
      </label>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Retry</span>
        <label className={`${styles.field} ${styles.fieldRow}`}>
          <input
            type="checkbox"
            checked={retryEnabled}
            onChange={(e) => onConfigValueChange('retry_enabled', e.target.checked)}
          />
          <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>Enable retries</span>
        </label>
        {retryEnabled ? (
          <>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>max attempts</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={5}
                value={String(maxAttempts)}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  const nextValue = Number.isFinite(parsed) ? Math.min(5, Math.max(1, parsed)) : 3;
                  onConfigValueChange('max_attempts', nextValue);
                }}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldRow}`}>
              <input
                type="checkbox"
                checked={config['retry_on_5xx'] !== false}
                onChange={(e) => onConfigValueChange('retry_on_5xx', e.target.checked)}
              />
              <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>Retry on 5xx errors</span>
            </label>
            <label className={`${styles.field} ${styles.fieldRow}`}>
              <input
                type="checkbox"
                checked={config['retry_on_timeout'] !== false}
                onChange={(e) => onConfigValueChange('retry_on_timeout', e.target.checked)}
              />
              <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>Retry on timeout / network error</span>
            </label>
            <label className={`${styles.field} ${styles.fieldRow}`}>
              <input
                type="checkbox"
                checked={config['retry_on_4xx'] === true}
                onChange={(e) => onConfigValueChange('retry_on_4xx', e.target.checked)}
              />
              <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>Retry on 4xx errors</span>
            </label>
          </>
        ) : null}
      </div>
      <div className={`${styles.field} ${styles.fieldFull}`}>
        <span className={styles.fieldLabel}>headers</span>
        {headers.map((header, i) => (
          <div key={i} className={styles.headerRow}>
            <input
              className={`${styles.input} ${styles.headerInput}`}
              placeholder="Header-Name"
              value={header.key}
              onChange={(e) => updateHeader(i, 'key', e.target.value)}
            />
            <input
              className={`${styles.input} ${styles.headerInput}`}
              placeholder="value"
              value={header.value}
              onChange={(e) => updateHeader(i, 'value', e.target.value)}
            />
            <button
              type="button"
              className={`${styles.input} ${styles.headerRemoveButton}`}
              onClick={() => removeHeader(i)}
            >×</button>
          </div>
        ))}
        <button
          type="button"
          className={`${styles.input} ${styles.addHeaderButton}`}
          onClick={addHeader}
        >
          + add header
        </button>
      </div>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Recent Deliveries</span>
        {deliveriesLoading ? <div className={styles.empty}>Loading recent deliveries...</div> : null}
        {!deliveriesLoading && deliveriesError ? <div className={styles.inlineWarning}>{deliveriesError}</div> : null}
        {!deliveriesLoading && !deliveriesError && recentDeliveries.length === 0 ? (
          <div className={styles.empty}>No recent deliveries.</div>
        ) : null}
        {!deliveriesLoading && !deliveriesError && recentDeliveries.length > 0 ? (
          <div className={styles.deliveryList}>
            {recentDeliveries.map((delivery) => (
              <div key={delivery.id} className={styles.deliveryItem}>
                <div className={styles.deliveryMeta}>
                  <span className={styles.deliveryTime}>{formatDateTime(delivery.createdAt)}</span>
                  <span className={styles.deliveryAttempt}>Attempt {delivery.attemptNumber}</span>
                </div>
                <span className={`${styles.deliveryBadge} ${delivery.success ? styles.deliverySuccess : styles.deliveryFailure}`}>
                  {delivery.success ? 'SUCCESS' : 'FAILED'}
                </span>
              </div>
            ))}
          </div>
        ) : null}
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
  const queueOptions = (queueItems ?? []).map((q) => ({ value: String(q.id), label: q.name }));
  const timeoutModeOptions = [
    { value: 'flow_default', label: 'use flow default' },
    { value: 'custom', label: 'custom timeout' },
  ];
  const useFlowDefaultTimeout = config['use_flow_default_timeout'] !== false;
  const selectedQueueIds = Array.isArray(config['queue_ids'])
    ? (config['queue_ids'] as unknown[]).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : (Number(config['queue_id'] || 0) > 0 ? [Number(config['queue_id'])] : []);
  const queueIdSet = new Set(selectedQueueIds);
  const promptItem = audioItems.find((a) => String(a.id) === String(config['prompt_audio_file_id']));
  const wrongPinItem = audioItems.find((a) => String(a.id) === String(config['wrong_pin_audio_file_id']));
  const successItem = audioItems.find((a) => String(a.id) === String(config['login_success_audio_file_id']));

  const addQueueId = (value: string | null) => {
    const queueId = Number(value || 0);
    if (!Number.isInteger(queueId) || queueId <= 0 || queueIdSet.has(queueId)) {
      return;
    }
    onConfigValueChange('queue_ids', [...selectedQueueIds, queueId]);
  };

  const toggleQueueId = (queueId: number, checked: boolean) => {
    if (checked) {
      if (queueIdSet.has(queueId)) return;
      onConfigValueChange('queue_ids', [...selectedQueueIds, queueId]);
      return;
    }
    onConfigValueChange('queue_ids', selectedQueueIds.filter((value) => value !== queueId));
  };

  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>queues</span>
        <SearchableSelect
          options={queueOptions.filter((option) => !queueIdSet.has(Number(option.value)))}
          value={null}
          onChange={addQueueId}
          placeholder="add queue"
        />
        <div className={styles.meta}>Select one or more queues. Operator login will apply to all selected queues.</div>
        <div className={styles.checkboxList}>
          {(queueItems ?? []).map((queue) => (
            <label key={queue.id} className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={queueIdSet.has(queue.id)}
                onChange={(event) => toggleQueueId(queue.id, event.target.checked)}
              />
              <span>{queue.name}</span>
            </label>
          ))}
        </div>
        {selectedQueueIds.length > 0 ? (
          <div className={styles.meta}>Selected queue IDs: {selectedQueueIds.join(', ')}</div>
        ) : null}
        {saveAttempted && selectedQueueIds.length === 0 ? (
          <span className={styles.inlineError}>At least one queue is required</span>
        ) : null}
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>input timeout mode</span>
        <SearchableSelect
          options={timeoutModeOptions}
          value={useFlowDefaultTimeout ? 'flow_default' : 'custom'}
          onChange={(value) => onConfigValueChange('use_flow_default_timeout', value !== 'custom')}
          placeholder="select timeout mode"
        />
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
          {saveAttempted
          && config['input_timeout_ms'] !== null
          && config['input_timeout_ms'] !== undefined
          && config['input_timeout_ms'] !== ''
          && (Number(config['input_timeout_ms']) < 1000 || Number(config['input_timeout_ms']) > 120000) ? (
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
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={promptItem?.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={wrongPinItem?.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
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
        return srcPath && srcPath.trim() ? <AudioPreviewPlayer key={successItem?.id} src={`${MEDIA_BASE}${srcPath}`} /> : null;
      })()}
    </>
  );
}

interface QueueConfigPanelProps {
  config: Record<string, unknown>;
  queueItems?: import('../../types').QueueItem[];
  onConfigValueChange: (field: string, value: unknown) => void;
  saveAttempted?: boolean;
}

function QueueConfigPanel({ config, queueItems, onConfigValueChange, saveAttempted }: QueueConfigPanelProps) {
 const queueOptions = (queueItems ?? []).map((q) => ({ value: String(q.id), label: q.name }));
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
      <div className={styles.toggleField}>
        <span className={styles.toggleLabel}>Record call</span>
        <button
          aria-checked={Boolean(config['record_call'])}
          aria-label="Record call"
          className={`${styles.toggleSwitch} ${Boolean(config['record_call']) ? styles.toggleOn : ''}`}
          onClick={() => onConfigValueChange('record_call', !Boolean(config['record_call']))}
          role="switch"
          type="button"
        >
          <span />
        </button>
      </div>
      <span className={styles.meta}>Records the conversation when an agent answers.</span>
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

      <label className={`${styles.field} ${styles.fieldRow}`}>
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
        <span className={`${styles.fieldLabel} ${styles.fieldLabelPlain}`}>wait for moderator</span>
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
