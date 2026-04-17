/**
 * NodeConfigPanel — right-side configuration panel.
 *
 * Purely presentational: no API calls, no ReactFlow hooks.
 * All state lives in the parent (FlowEditorPage) and is passed as props.
 *
 * Sub-panels per node type (PlayAudioConfig, GetDigitsConfig, MenuConfig,
 * TransferConfig) are kept as local components in this file per task rules.
 *
 * NOTE: The 8-prop limit is approached here. Additional props beyond the
 * specified interface  (submenuNodeOptionsLoading, submenuStartNodeKey,
 * selectedMenuLocalEdgeBranches) are grouped into an optional `menuExtra`
 * bag rather than individual props to keep the interface compact.
 */
import type { Edge, Node } from 'reactflow';
import type { AudioFileItem, BuilderNodeType, FlowNodeData } from '../../types';
import { SearchableSelect } from '../common/SearchableSelect';
import { HuntConfigPanel } from '../panels/HuntConfigPanel';
import styles from './NodeConfigPanel.module.css';
import pageStyles from '../../pages/FlowEditorPage.module.css';

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
  // Config change handlers
  onLabelChange: (value: string) => void;
  onConfigChange: (field: string, value: string) => void;
  onConfigValueChange: (field: string, value: unknown) => void;
  onConfigReplace: (nextConfig: Record<string, unknown>) => void;
  onEdgeConditionChange: (value: string | null) => void;
  onMenuBranchToggle: (branch: string, checked: boolean) => void;
  onMenuSubflowTargetChange: (branch: string, targetNodeKey: string | null) => void;
  // Extra menu panel data
  menuExtra: NodeConfigPanelMenuExtra;
  // Validation trigger
  saveAttempted?: boolean;
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
  saveAttempted = false,
}: NodeConfigPanelProps) {
  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const audioFileSelected = Number(selectedConfig.audio_file_id || 0) > 0;
  const promptAudioSelected = Number(selectedConfig.prompt_audio_file_id || 0) > 0;
  const selectedMenuBranches = sanitizeMenuBranches(selectedConfig.branches);

  const audioOptions = audioItems.map((item) => ({ value: String(item.id), label: item.name }));
  const nodeOptions = nodes.map((node) => ({ value: node.id, label: `${node.id} — ${node.data.label}` }));
  const conditionOptions = conditionValues.map((value) => ({ value, label: value }));

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
      <div className={pageStyles.panelTitle}>{selectedEdge ? 'edge config' : 'node config'}</div>
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
                  value={String(selectedConfig.timeout_ms || 5000)}
                  onChange={(event) => onConfigChange('timeout_ms', event.target.value)}
                />
              </label>
            </>
          ) : null}

          {selectedNode.data.type === 'menu' ? (
            <MenuConfig
              selectedNode={selectedNode}
              selectedConfig={selectedConfig}
              selectedMenuBranches={selectedMenuBranches}
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
              nodeOptions={nodeOptions}
              onConfigReplace={onConfigReplace}
            />
          ) : null}

          {selectedNode.data.type === 'transfer' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>destination</span>
                <input
                  className={styles.input}
                  placeholder="SIP/trunk/+94XXXXXXXXX"
                  value={String(selectedConfig.destination || '')}
                  onChange={(event) => onConfigChange('destination', event.target.value)}
                />
                {saveAttempted && !String(selectedConfig.destination || '').trim() ? (
                  <span className={styles.inlineError}>Destination is required</span>
                ) : null}
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>timeout_ms</span>
                <input
                  className={styles.input}
                  type="number"
                  value={String(selectedConfig.timeout_ms || 30000)}
                  onChange={(event) => onConfigChange('timeout_ms', event.target.value)}
                />
                {saveAttempted && Number(selectedConfig.timeout_ms || 0) <= 0 ? (
                  <span className={styles.inlineError}>Timeout must be greater than 0</span>
                ) : null}
              </label>
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
          ) : null}

          <div className={styles.meta}>node key: {selectedNode.id}</div>
          <div className={styles.meta}>type: {selectedNode.data.type}</div>
        </div>
      ) : (
        <div className={styles.empty}>Select a node or edge to edit its config.</div>
      )}
    </>
  );
}


interface MenuConfigProps {
  selectedNode: Node<FlowNodeData>;
  selectedConfig: Record<string, unknown>;
  selectedMenuBranches: string[];
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
  audioOptions,
  promptAudioSelected,
  menuExtra,
  onConfigChange,
  onMenuBranchToggle,
  saveAttempted = false,
}: MenuConfigProps) {
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
      <label className={styles.field}>
        <span className={styles.fieldLabel}>invalid prompt audio</span>
        <SearchableSelect
          options={audioOptions}
          value={selectedConfig.invalid_prompt_audio_id ? String(selectedConfig.invalid_prompt_audio_id) : null}
          onChange={(value) => onConfigChange('invalid_prompt_audio_id', value || '')}
          placeholder="select invalid prompt"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>final failure audio</span>
        <SearchableSelect
          options={audioOptions}
          value={selectedConfig.final_failure_audio_id ? String(selectedConfig.final_failure_audio_id) : null}
          onChange={(value) => onConfigChange('final_failure_audio_id', value || '')}
          placeholder="select goodbye prompt"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>timeout_ms</span>
        <input
          className={styles.input}
          type="number"
          value={String(selectedConfig.timeout_ms || 5000)}
          onChange={(event) => onConfigChange('timeout_ms', event.target.value)}
        />
        {saveAttempted && Number(selectedConfig.timeout_ms || 0) <= 0 ? (
          <span className={styles.inlineError}>Timeout must be greater than 0</span>
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
