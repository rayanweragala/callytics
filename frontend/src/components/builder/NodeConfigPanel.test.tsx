import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Edge, Node as FlowNode } from 'reactflow';
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
    edges: [],
    onLabelChange: vi.fn(),
    onConfigChange: vi.fn(),
    onConfigValueChange: vi.fn(),
    onConfigReplace: vi.fn(),
    onEdgeConditionChange: vi.fn(),
    onMenuBranchToggle: vi.fn(),
    menuExtra: {
      selectedMenuLocalEdgeBranches: new Set<string>(),
      selectedMenuBranchFlows: {},
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

  it('renders explicit submenu action and branch routing states for menu nodes', () => {
    const onOpenSubmenuAction = vi.fn();
    const node = mockNode('menu', {
      prompt_audio_file_id: 1,
      timeout_ms: 5000,
      branches: ['1', '2'],
      submenu_branch_names: { '1': 'Sales submenu' },
    });

    render(
      <NodeConfigPanel
        {...baseProps}
        selectedNode={node}
        nodes={[
          node,
          {
            id: 'play-1',
            type: 'flowNode',
            position: { x: 0, y: 0 },
            data: { type: 'play_audio', label: 'Main prompt', config: {} } as FlowNodeData,
          },
        ]}
        edges={[
          {
            id: 'menu-branch-2',
            source: 'node-1',
            target: 'play-1',
            data: { branchKey: '2', condition: '2', sourceNodeType: 'menu' },
          } as any,
        ]}
        menuExtra={{
          selectedMenuLocalEdgeBranches: new Set(['2']),
          selectedMenuBranchFlows: {},
        }}
        onOpenSubmenuAction={onOpenSubmenuAction}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create submenu' })).toBeInTheDocument();
    expect(screen.getByText('branch routing')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sales submenu')).toBeInTheDocument();
    expect(screen.getByText('unrouted')).toBeInTheDocument();
    expect(screen.getByText('main flow')).toBeInTheDocument();
    expect(screen.getByText('Main prompt')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create submenu' }));
    expect(onOpenSubmenuAction).toHaveBeenCalledWith('node-1', '1');
  });

  it('shows open submenu when subflow already exists', () => {
    const onOpenSubmenuAction = vi.fn();
    const node = mockNode('menu', { prompt_audio_file_id: 1, timeout_ms: 5000, branches: ['1'] });

    render(
      <NodeConfigPanel
        {...baseProps}
        selectedNode={node}
        menuExtra={{
          selectedMenuLocalEdgeBranches: new Set(),
          selectedMenuBranchFlows: { '1': { flowId: 77, name: 'Billing submenu' } },
        }}
        onOpenSubmenuAction={onOpenSubmenuAction}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open submenu' })).toBeInTheDocument();
    expect(screen.getByText('Billing submenu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open submenu' }));
    expect(onOpenSubmenuAction).toHaveBeenCalledWith('node-1', '1');
  });

  it('keeps the submenu rename draft during parent rerenders', () => {
    const node = mockNode('menu', { prompt_audio_file_id: 1, timeout_ms: 5000, branches: ['1'] });
    const initialProps = {
      ...baseProps,
      selectedNode: node,
      menuExtra: {
        selectedMenuLocalEdgeBranches: new Set<string>(),
        selectedMenuBranchFlows: { '1': { flowId: 77, name: 'Billing submenu' } },
      },
    };

    const { rerender } = render(<NodeConfigPanel {...initialProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename submenu 1' }));
    const renameInput = screen.getByDisplayValue('Billing submenu');
    fireEvent.change(renameInput, { target: { value: 'Billing submenu updated' } });

    rerender(
      <NodeConfigPanel
        {...baseProps}
        selectedNode={node}
        menuExtra={{
          selectedMenuLocalEdgeBranches: new Set<string>(),
          selectedMenuBranchFlows: { '1': { flowId: 77, name: 'Billing submenu' } },
        }}
      />,
    );

    expect(screen.getByDisplayValue('Billing submenu updated')).toBeInTheDocument();
  });

  it('renders a custom submenu name input before submenu creation', () => {
    const node = mockNode('menu', {
      prompt_audio_file_id: 1,
      timeout_ms: 5000,
      branches: ['1'],
      submenu_branch_names: { '1': 'VIP branch' },
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} />);

    expect(screen.getByDisplayValue('VIP branch')).toBeInTheDocument();
  });

  it('does not render final failure audio for menu nodes', () => {
    const node = mockNode('menu', {
      prompt_audio_file_id: 1,
      timeout_ms: 5000,
      branches: ['1'],
      final_failure_audio_id: 2,
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} />);

    expect(screen.queryByText('final failure audio')).not.toBeInTheDocument();
  });

  it('resets audio preview when switching to a different node with the same audio source', async () => {
    const audioItemsWithPreview: AudioFileItem[] = [
      { ...mockAudioItems[0], previewUrl: '/audio/previews/test-audio.wav' },
      mockAudioItems[1],
    ];
    const firstNode = {
      id: 'play-1',
      type: 'flowNode',
      position: { x: 0, y: 0 },
      data: { type: 'play_audio', label: 'First node', config: { audio_file_id: 1, audio_file_path: '' } } as FlowNodeData,
    };
    const secondNode = {
      id: 'play-2',
      type: 'flowNode',
      position: { x: 0, y: 0 },
      data: { type: 'play_audio', label: 'Second node', config: { audio_file_id: 1, audio_file_path: '' } } as FlowNodeData,
    };

    const { rerender } = render(<NodeConfigPanel {...baseProps} audioItems={audioItemsWithPreview} selectedNode={firstNode} />);

    fireEvent.click(screen.getByRole('button', { name: 'play' }));
    expect(await screen.findByRole('button', { name: 'pause' })).toBeInTheDocument();

    rerender(<NodeConfigPanel {...baseProps} audioItems={audioItemsWithPreview} selectedNode={secondNode} />);

    expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument();
  });

  it('hides audio preview controls when selection is cleared', async () => {
    const audioItemsWithPreview: AudioFileItem[] = [
      { ...mockAudioItems[0], previewUrl: '/audio/previews/test-audio.wav' },
      mockAudioItems[1],
    ];
    const node = {
      id: 'play-1',
      type: 'flowNode',
      position: { x: 0, y: 0 },
      data: { type: 'play_audio', label: 'Audio node', config: { audio_file_id: 1, audio_file_path: '' } } as FlowNodeData,
    };

    const { rerender } = render(<NodeConfigPanel {...baseProps} audioItems={audioItemsWithPreview} selectedNode={node} />);

    expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument();

    rerender(<NodeConfigPanel {...baseProps} audioItems={audioItemsWithPreview} selectedNode={null} selectedEdge={null} selectedEdgeSourceNode={null} />);

    expect(screen.getByText('Select a node to configure it')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'play' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'mute' })).not.toBeInTheDocument();
  });

  it('renders prompt audio field for queue_login node', () => {
    const node = mockNode('queue_login', { queue_ids: [1], prompt_audio_file_id: null });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.getByText('prompt audio')).toBeInTheDocument();
  });

  it('does not render prompt audio field for queue node', () => {
    const node = mockNode('queue', { queue_id: 1, prompt_audio_file_id: null });
    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);
    expect(screen.queryByText('prompt audio')).not.toBeInTheDocument();
  });

  it('always shows voicemail webhook toggle without requiring a webhook node edge', () => {
    const node = mockNode('voicemail', {
      mailbox_name: 'main',
      max_duration_seconds: 60,
      start_audio_id: 1,
      send_to_webhook: false,
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);

    expect(screen.getByLabelText('Send recording with webhook request')).toBeInTheDocument();
  });

  it('shows inline warning when voicemail webhook recording is enabled without an outgoing webhook edge', () => {
    const node = mockNode('voicemail', {
      mailbox_name: 'main',
      max_duration_seconds: 60,
      start_audio_id: 1,
      send_to_webhook: true,
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);

    expect(screen.getByText('Connect a Webhook node to receive the recording.')).toBeInTheDocument();
  });

  it('does not show voicemail webhook warning when an outgoing webhook edge exists', () => {
    const node = mockNode('voicemail', {
      mailbox_name: 'main',
      max_duration_seconds: 60,
      start_audio_id: 1,
      send_to_webhook: true,
    });
    const webhookNode = {
      id: 'webhook-1',
      type: 'flowNode',
      position: { x: 200, y: 100 },
      data: { type: 'webhook', label: 'Webhook', config: { url: 'https://example.com/hook' } } as FlowNodeData,
    };
    const edges = [{ id: 'vm-webhook', source: node.id, target: webhookNode.id }];

    render(<NodeConfigPanel {...baseProps} selectedNode={node} nodes={[node, webhookNode]} edges={edges} saveAttempted={false} />);

    expect(screen.queryByText('Connect a Webhook node to receive the recording.')).not.toBeInTheDocument();
  });

  it('shows transfer recording webhook toggle only when record call is enabled', () => {
    const node = mockNode('transfer', {
      target_type: 'extension',
      target_value: '1001',
      record_call: true,
      send_to_webhook: false,
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);

    expect(screen.getByLabelText('Send recording with webhook request')).toBeInTheDocument();
  });

  it('shows transfer inline warning when recording webhook is enabled without an outgoing webhook edge', () => {
    const node = mockNode('transfer', {
      target_type: 'extension',
      target_value: '1001',
      record_call: true,
      send_to_webhook: true,
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);

    expect(screen.getByText('Connect a Webhook node to receive the recording.')).toBeInTheDocument();
  });

  it('shows hunt inline warning when recording webhook is enabled without an outgoing webhook edge', () => {
    const node = mockNode('hunt', {
      destinations: [{ target_type: 'extension', target_value: '1001' }],
      record_call: true,
      send_to_webhook: true,
    });

    render(<NodeConfigPanel {...baseProps} selectedNode={node} saveAttempted={false} />);

    expect(screen.getByText('Connect a Webhook node to receive the recording.')).toBeInTheDocument();
  });

  it('does not show hunt warning when an outgoing webhook edge exists', () => {
    const node = mockNode('hunt', {
      destinations: [{ target_type: 'extension', target_value: '1001' }],
      record_call: true,
      send_to_webhook: true,
    });
    const webhookNode = {
      id: 'webhook-1',
      type: 'flowNode',
      position: { x: 200, y: 100 },
      data: { type: 'webhook', label: 'Webhook', config: { url: 'https://example.com/hook' } } as FlowNodeData,
    };
    const edges = [{ id: 'hunt-webhook', source: node.id, target: webhookNode.id }];

    render(<NodeConfigPanel {...baseProps} selectedNode={node} nodes={[node, webhookNode]} edges={edges} saveAttempted={false} />);

    expect(screen.queryByText('Connect a Webhook node to receive the recording.')).not.toBeInTheDocument();
  });

  it('renders editable get_digits edge condition input with current 2-digit value', () => {
    const onEdgeConditionChange = vi.fn();
    const selectedEdge = {
      id: 'edge-1',
      source: 'digits-1',
      target: 'hangup-1',
      data: { branchKey: '16', condition: '16', sourceNodeType: 'get_digits' },
    } as Edge<any>;
    const selectedEdgeSourceNode = mockNode('get_digits', { variable_name: 'digits', timeout_ms: 5000 });
    selectedEdgeSourceNode.id = 'digits-1';

    render(
      <NodeConfigPanel
        {...baseProps}
        selectedEdge={selectedEdge}
        selectedEdgeSourceNode={selectedEdgeSourceNode}
        onEdgeConditionChange={onEdgeConditionChange}
      />,
    );

    const input = screen.getByDisplayValue('16');
    expect(input).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '99' } });
    expect(onEdgeConditionChange).toHaveBeenCalledWith('99');
  });

  it('shows inline validation when a get_digits edge condition exceeds 2 digits', () => {
    const selectedEdge = {
      id: 'edge-1',
      source: 'digits-1',
      target: 'hangup-1',
      data: { branchKey: '123', condition: '123', sourceNodeType: 'get_digits' },
    } as Edge<any>;
    const selectedEdgeSourceNode = mockNode('get_digits', { variable_name: 'digits', timeout_ms: 5000 });
    selectedEdgeSourceNode.id = 'digits-1';

    render(
      <NodeConfigPanel
        {...baseProps}
        selectedEdge={selectedEdge}
        selectedEdgeSourceNode={selectedEdgeSourceNode}
      />,
    );

    expect(screen.getByText('Use 1-2 digits, *, #, timeout, invalid, or default')).toBeInTheDocument();
  });

  it('callback destination labels follow destination type', () => {
    const extensionNode = mockNode('callback', { destination_type: 'extension', destination_value: null });
    const { rerender } = render(
      <NodeConfigPanel
        {...baseProps}
        selectedNode={extensionNode}
        extensions={[{ id: 1, username: '2001', password: 'x', displayName: 'Desk 2001', transportType: 'sip', createdAt: '2024-01-01', vpnOnly: false }]}
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
        extensions={[{ id: 1, username: '2001', password: 'x', displayName: 'Desk 2001', transportType: 'sip', createdAt: '2024-01-01', vpnOnly: false }]}
        contactNumbers={[{ id: 1, label: 'Main PSTN', number: '+94112223344', trunkId: 2, createdAt: '2024-01-01' }]}
      />,
    );

    expect(screen.getByText('pstn number')).toBeInTheDocument();
  });

  it('renders conference room fields and sanitizes room name input', () => {
    const onConfigValueChange = vi.fn();

    function Wrapper() {
      const [config, setConfig] = useState<Record<string, unknown>>({
        roomName: '',
        waitForModerator: false,
        moderatorType: null,
        moderatorId: null,
      });

      return (
        <NodeConfigPanel
          {...baseProps}
          selectedNode={mockNode('conference', config)}
          extensions={[
            { id: 11, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: '2024-01-01', vpnOnly: false },
          ]}
          operators={[
            { id: 21, name: 'Main Operator', status: 'available', extension: undefined, contactNumber: { id: 1, label: 'Main', number: '+94770000000', trunkId: 1, createdAt: '2024-01-01' }, hasPIN: true, createdAt: '2024-01-01' },
          ]}
          onConfigValueChange={(field, value) => {
            onConfigValueChange(field, value);
            setConfig((current) => ({ ...current, [field]: value }));
          }}
        />
      );
    }

    render(<Wrapper />);

    expect(screen.getByText('room name')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('SalesRoom1'), { target: { value: 'Sales Room 1!@#' } });

    expect(onConfigValueChange).toHaveBeenCalledWith('roomName', 'SalesRoom1');
    expect(screen.getByPlaceholderText('SalesRoom1')).toHaveValue('SalesRoom1');
  });

  it('keeps wait for moderator off by default and reveals moderator type when enabled', () => {
    function Wrapper() {
      const [config, setConfig] = useState<Record<string, unknown>>({
        roomName: 'SalesRoom1',
        waitForModerator: false,
        moderatorType: null,
        moderatorId: null,
      });

      return (
        <NodeConfigPanel
          {...baseProps}
          selectedNode={mockNode('conference', config)}
          extensions={[
            { id: 11, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: '2024-01-01', vpnOnly: false },
          ]}
          operators={[
            { id: 21, name: 'Main Operator', status: 'available', extension: undefined, contactNumber: { id: 1, label: 'Main', number: '+94770000000', trunkId: 1, createdAt: '2024-01-01' }, hasPIN: true, createdAt: '2024-01-01' },
          ]}
          onConfigValueChange={(field, value) => {
            setConfig((current) => ({ ...current, [field]: value }));
          }}
        />
      );
    }

    render(<Wrapper />);

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    expect(screen.getByText('moderator type')).toBeInTheDocument();
    expect(screen.getByText('Extension')).toBeInTheDocument();
  });

  it('loads extension and operator options and saves moderator selection', () => {
    const onConfigValueChange = vi.fn();

    function Wrapper() {
      const [config, setConfig] = useState<Record<string, unknown>>({
        roomName: 'SalesRoom1',
        waitForModerator: true,
        moderatorType: 'extension',
        moderatorId: null,
      });

      return (
        <NodeConfigPanel
          {...baseProps}
          selectedNode={mockNode('conference', config)}
          extensions={[
            { id: 11, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: '2024-01-01', vpnOnly: false },
          ]}
          operators={[
            { id: 21, name: 'Main Operator', status: 'available', extension: undefined, contactNumber: { id: 1, label: 'Main', number: '+94770000000', trunkId: 1, createdAt: '2024-01-01' }, hasPIN: true, createdAt: '2024-01-01' },
          ]}
          onConfigValueChange={(field, value) => {
            onConfigValueChange(field, value);
            setConfig((current) => ({ ...current, [field]: value }));
          }}
        />
      );
    }

    render(<Wrapper />);

    fireEvent.click(screen.getByText('select extension'));
    expect(screen.getByText('2001 — Alice')).toBeInTheDocument();
    fireEvent.click(screen.getByText('2001 — Alice'));

    expect(onConfigValueChange).toHaveBeenCalledWith('moderatorType', 'extension');
    expect(onConfigValueChange).toHaveBeenCalledWith('moderatorId', 11);
  });

  it('switches to PSTN operator selection when moderator type changes', () => {
    function Wrapper() {
      const [config, setConfig] = useState<Record<string, unknown>>({
        roomName: 'SalesRoom1',
        waitForModerator: true,
        moderatorType: 'extension',
        moderatorId: null,
      });

      return (
        <NodeConfigPanel
          {...baseProps}
          selectedNode={mockNode('conference', config)}
          extensions={[
            { id: 11, username: '2001', password: 'x', displayName: 'Alice', transportType: 'sip', createdAt: '2024-01-01', vpnOnly: false },
          ]}
          operators={[
            { id: 21, name: 'Main Operator', status: 'available', extension: undefined, contactNumber: { id: 1, label: 'Main', number: '+94770000000', trunkId: 1, createdAt: '2024-01-01' }, hasPIN: true, createdAt: '2024-01-01' },
          ]}
          onConfigValueChange={(field, value) => {
            setConfig((current) => ({ ...current, [field]: value }));
          }}
        />
      );
    }

    render(<Wrapper />);

    fireEvent.click(screen.getByText('Extension'));
    fireEvent.click(screen.getByText('PSTN Operator'));

    expect(screen.getByText('pstn operator')).toBeInTheDocument();
    fireEvent.click(screen.getByText('select PSTN operator'));
    expect(screen.getByText('Main Operator — +94770000000')).toBeInTheDocument();
  });
});
