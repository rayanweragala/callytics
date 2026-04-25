import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Node as FlowNode } from 'reactflow';
import { NodeConfigPanel } from './NodeConfigPanel';
import type { FlowNodeData, AudioFileItem } from '../../types';

const mockNode = (type: string, config: Record<string, unknown> = {}): FlowNode<FlowNodeData> => ({
  id: 'node-1',
  type: 'flowNode',
  position: { x: 100, y: 100 },
  data: { type, label: 'Test Node', config } as FlowNodeData,
});

const mockAudioItems: AudioFileItem[] = [
  { id: 1, name: 'Audio 1', sourceType: 'upload', originalFilename: null, mimeType: null, durationMs: 5000, conversionStatus: 'complete', ttsText: null, ttsVoice: null, speed: 1, originalUrl: null, previewUrl: null, convertedUrl: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  { id: 2, name: 'Audio 2', sourceType: 'upload', originalFilename: null, mimeType: null, durationMs: 10000, conversionStatus: 'complete', ttsText: null, ttsVoice: null, speed: 1, originalUrl: null, previewUrl: null, convertedUrl: null, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
];

describe('NodeConfigPanel', () => {
  const baseProps = {
    selectedNode: null,
    selectedEdge: null,
    selectedEdgeSourceNode: null,
    audioItems: mockAudioItems,
    nodes: [],
    onLabelChange: vi.fn(),
    onConfigChange: vi.fn(),
    onConfigValueChange: vi.fn(),
    onConfigReplace: vi.fn(),
    onEdgeConditionChange: vi.fn(),
    onMenuBranchToggle: vi.fn(),
    onMenuSubflowTargetChange: vi.fn(),
    menuExtra: {
      submenuNodeOptionsLoading: false,
      submenuStartNodeKey: null,
      selectedMenuLocalEdgeBranches: new Set<string>(),
      selectedMenuSubmenuTargets: {},
    },
  };

  it('renders error for transfer node with empty target_value when save attempted', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '', timeout_ms: 30000 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.getByText('Target value is required')).toBeInTheDocument();
  });

  it('does not render error for transfer node with non-empty target_value when save attempted', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '2001', timeout_ms: 30000 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.queryByText('Target value is required')).not.toBeInTheDocument();
  });

  it('does not render error on initial load without saveAttempted', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '', timeout_ms: 30000 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.queryByText('Target value is required')).not.toBeInTheDocument();
  });

  it('renders error for transfer node with invalid timeout_ms when save attempted', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '2001', timeout_ms: 0 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.getByText('Timeout must be between 1000 and 120000 ms')).toBeInTheDocument();
  });

  it('renders transfer waiting/no-answer sound selectors', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '2001', timeout_ms: 30000, waiting_sound_id: 1, no_answer_sound_id: 2 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.getByText('WAITING_SOUND')).toBeInTheDocument();
    expect(screen.getByText('NO_ANSWER_SOUND')).toBeInTheDocument();
  });

  it('transfer node shows waiting_sound_id field', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '2001', timeout_ms: 30000 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.getByText('WAITING_SOUND')).toBeInTheDocument();
  });

  it('transfer node shows no_answer_sound_id field', () => {
    const node = mockNode('transfer', { target_type: 'extension', target_value: '2001', timeout_ms: 30000 });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.getByText('NO_ANSWER_SOUND')).toBeInTheDocument();
  });

  it('renders error for menu node with missing prompt_audio_file_id when save attempted', () => {
    const node = mockNode('menu', { prompt_audio_file_id: '', timeout_ms: 5000, branches: ['1', '2'] });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.getByText('Prompt audio is required')).toBeInTheDocument();
  });

  it('renders error for menu node with invalid prompt_audio_file_id when save attempted', () => {
    const node = mockNode('menu', { prompt_audio_file_id: 0, timeout_ms: 5000, branches: ['1', '2'] });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.getByText('Prompt audio is required')).toBeInTheDocument();
  });

  it('renders error for menu node with invalid timeout_ms when save attempted', () => {
    const node = mockNode('menu', { prompt_audio_file_id: 1, timeout_ms: -100, branches: ['1', '2'] });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.getByText('Timeout must be between 1000 and 120000 ms')).toBeInTheDocument();
  });

  it('renders error for menu node with empty branches when save attempted', () => {
    const node = mockNode('menu', { prompt_audio_file_id: 1, timeout_ms: 5000, branches: null });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.queryByText('At least one branch is required')).not.toBeInTheDocument();
  });

  it('does not render error for menu node with valid config when save attempted', () => {
    const node = mockNode('menu', { prompt_audio_file_id: 1, timeout_ms: 5000, branches: ['1', '2'] });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={true} />);
    expect(screen.queryByText('Prompt audio is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Timeout must be greater than 0')).not.toBeInTheDocument();
    expect(screen.queryByText('At least one branch is required')).not.toBeInTheDocument();
  });

  it('does not render error on initial load for menu without saveAttempted', () => {
    const node = mockNode('menu', { prompt_audio_file_id: '', timeout_ms: 0, branches: [] });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.queryByText('Prompt audio is required')).not.toBeInTheDocument();
    expect(screen.queryByText('Timeout must be greater than 0')).not.toBeInTheDocument();
    expect(screen.queryByText('At least one branch is required')).not.toBeInTheDocument();
  });

  it('renders prompt audio field for queue_login node', () => {
    const node = mockNode('queue_login', { queue_id: 1, prompt_audio_file_id: null });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.getByText('prompt audio')).toBeInTheDocument();
  });

  it('renders prompt audio field for queue node', () => {
    const node = mockNode('queue', { queue_id: 1, prompt_audio_file_id: null });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.getByText('prompt audio')).toBeInTheDocument();
  });

  it('callback destination labels follow destination type', () => {
    const extensionNode = mockNode('callback', { destination_type: 'extension', destination_value: null });
    const { rerender } = render(
      <NodeConfigPanel
        {...baseProps}
        selectedNode={extensionNode}
        extensions={[{ id: 1, username: '2001', password: 'x', displayName: 'Desk 2001', transportType: 'sip', createdAt: '2024-01-01' }]}
        contactNumbers={[{ id: 1, label: 'Main PSTN', number: '+94112223344', trunkId: 2, createdAt: '2024-01-01' }]}
      />,
    );

    expect(screen.getByText('destination type')).toBeInTheDocument();
    expect(screen.getByText('extension')).toBeInTheDocument();
    expect(screen.queryByText('pstn number')).not.toBeInTheDocument();

    const pstnNode = mockNode('callback', { destination_type: 'pstn', destination_value: null });
    rerender(
      <NodeConfigPanel
        {...baseProps}
        selectedNode={pstnNode}
        extensions={[{ id: 1, username: '2001', password: 'x', displayName: 'Desk 2001', transportType: 'sip', createdAt: '2024-01-01' }]}
        contactNumbers={[{ id: 1, label: 'Main PSTN', number: '+94112223344', trunkId: 2, createdAt: '2024-01-01' }]}
      />,
    );

    expect(screen.getByText('pstn number')).toBeInTheDocument();
  });
});
