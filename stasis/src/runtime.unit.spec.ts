jest.mock('./nodes', () => ({
  executeNode: jest.fn(),
}));

jest.mock('./db', () => ({
  query: jest.fn().mockResolvedValue([]),
}));

jest.mock('./telemetry', () => ({
  publishCallEvent: jest.fn().mockResolvedValue(undefined),
  publishNodeTelemetry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./executors/webhook.executor', () => ({
  fireWebhookAsync: jest.fn(),
}));

import { executeNode } from './nodes';
import { query } from './db';
import { runFlow } from './runtime';
import type { CallSession } from './callSession';
import { fireWebhookAsync } from './executors/webhook.executor';

const executeNodeMock = executeNode as jest.MockedFunction<typeof executeNode>;
const queryMock = query as jest.MockedFunction<typeof query>;
const fireWebhookAsyncMock = fireWebhookAsync as jest.MockedFunction<typeof fireWebhookAsync>;

function createSession(): CallSession {
  const startedAt = new Date();
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '1000',
    currentNodeKey: 'start',
    variables: {},
    webhookPayload: {},
    call_started_at: startedAt.toISOString(),
    call_ended_at: null,
    startedAt,
    recording: null,
    inboundBridge: null,
    flow: {
      id: 19,
      name: 'Test Flow',
      versionId: 101,
      nodes: [
        { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
        { nodeKey: 'play-1', type: 'play_audio', label: 'Play', config: {} },
      ],
      edges: [
        { sourceNodeKey: 'start', targetNodeKey: 'play-1', branchKey: 'default', condition: null },
      ],
    },
  };
}

function createAriEventClient() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  return {
    on: jest.fn((event: string, listener: (...args: any[]) => void) => {
      const bucket = listeners.get(event) || new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    }),
    removeListener: jest.fn((event: string, listener: (...args: any[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit(event: string, ...args: any[]) {
      for (const listener of Array.from(listeners.get(event) || [])) {
        listener(...args);
      }
    },
  };
}

describe('runFlow dead-end safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hangs up when a play_audio leaf has no outgoing edge', async () => {
    const session = createSession();
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('default');

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).toHaveBeenCalledTimes(2);
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('hangs up when a node returns terminal hangup result', async () => {
    const session = createSession();
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('hangup');

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).toHaveBeenCalledTimes(2);
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('hangs up when a node returns terminal done result', async () => {
    const session = createSession();
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('done');

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).toHaveBeenCalledTimes(2);
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('routes menu branch into mapped submenu target node', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        config: { branches: ['1', '2'], submenu_branch_targets: { '2': 'sub-play-2' } },
      },
      { nodeKey: 'play-1', type: 'play_audio', label: 'Play 1', config: {} },
      { nodeKey: 'after-sub', type: 'hangup', label: 'Hangup', config: {} },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'play-1', branchKey: '1', condition: '1' },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'after-sub', branchKey: 'complete', condition: 'complete' },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM flow_nodes') && sql.includes('WHERE flow_version_id = $1 AND node_key = $2')) {
        return [{ subflow_id: 222 }];
      }
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Subflow', current_version_id: 333 }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'sub-play-2', type: 'play_audio', label: 'Sub Play', config_json: {} },
          { node_key: 'sub-hangup', type: 'hangup', label: 'Hangup', config_json: {} },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { source_node_key: 'start', target_node_key: 'sub-play-2', branch_key: 'default', condition: null },
          { source_node_key: 'sub-play-2', target_node_key: 'sub-hangup', branch_key: 'default', condition: null },
        ];
      }
      return [];
    });

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('done');

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).toHaveBeenCalledTimes(5);
    expect(executeNodeMock.mock.calls[2]?.[1]?.nodeKey).toBe('sub-play-2');
    expect(executeNodeMock.mock.calls[4]?.[1]?.nodeKey).toBe('after-sub');
  });

  it('routes menu branch into submenu_branch_flows flowId when no edge exists', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        config: {
          branches: ['1', '2'],
          submenu_branch_flows: {
            '1': { flowId: 222, name: 'sales_menu' },
          },
        },
      },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Subflow', current_version_id: 333, status: 'published' }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'sub-hangup', type: 'hangup', label: 'Hangup', config_json: {} },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { source_node_key: 'start', target_node_key: 'sub-hangup', branch_key: 'default', condition: null },
        ];
      }
      return [];
    });

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('hangup');

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).toHaveBeenCalledTimes(4);
    expect(executeNodeMock.mock.calls[2]?.[1]?.nodeKey).toBe('start');
    expect(executeNodeMock.mock.calls[3]?.[1]?.nodeKey).toBe('sub-hangup');
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('routes menu branch into submenu by parent_branch_key lookup when config has no submenu map', async () => {
    const session = createSession();
    session.flow.id = 1685;
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        config: { branches: ['1', '2'] },
      },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM call_flows') && sql.includes('parent_flow_id = $1')) {
        expect(params).toEqual([1685, 'menu-1', '1']);
        return [{ id: 222 }];
      }
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Subflow', current_version_id: 333, status: 'published' }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'sub-hangup', type: 'hangup', label: 'Hangup', config_json: {} },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { source_node_key: 'start', target_node_key: 'sub-hangup', branch_key: 'default', condition: null },
        ];
      }
      return [];
    });

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('hangup');

    await runFlow(channel as never, session, {});

    expect(executeNodeMock).toHaveBeenCalledTimes(4);
    expect(executeNodeMock.mock.calls[2]?.[1]?.nodeKey).toBe('start');
    expect(executeNodeMock.mock.calls[3]?.[1]?.nodeKey).toBe('sub-hangup');
  });

  it('treats queue_login authenticated as terminal when no outgoing edge exists', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      { nodeKey: 'queue-login-1', type: 'queue_login', label: 'Queue Login', config: { queue_ids: [1] } },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'queue-login-1', branchKey: 'default', condition: null },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('authenticated');

    await expect(runFlow(channel as never, session, {})).resolves.toEqual({ status: 'completed' });
    expect(executeNodeMock).toHaveBeenCalledTimes(2);
  });

  it('fires webhook side-effect asynchronously and continues on non-webhook edge', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      { nodeKey: 'play-1', type: 'play_audio', label: 'Play', config: {} },
      { nodeKey: 'menu-1', type: 'menu', label: 'Menu', config: { branches: ['1'] } },
      { nodeKey: 'webhook-1', type: 'webhook', label: 'Webhook', config: { url: 'https://example.com/webhook' } },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'play-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'play-1', targetNodeKey: 'webhook-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'play-1', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('done');

    await expect(runFlow(channel as never, session, {})).resolves.toEqual({ status: 'completed' });
    expect(executeNodeMock).toHaveBeenCalledTimes(3);
    expect(executeNodeMock.mock.calls[2]?.[1]?.nodeKey).toBe('menu-1');
    expect(fireWebhookAsyncMock).toHaveBeenCalledTimes(1);
    expect(fireWebhookAsyncMock.mock.calls[0]?.[0]?.nodeKey).toBe('webhook-1');
  });

  it('fires voicemail webhook edge from the voicemail node after done instead of returning to parent menu', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        config: {
          branches: ['1'],
          submenu_branch_flows: {
            '1': { flowId: 222, name: 'voicemail_subflow' },
          },
        },
      },
      { nodeKey: 'after-sub', type: 'play_audio', label: 'After Subflow', config: {} },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'after-sub', branchKey: 'complete', condition: 'complete' },
    ];
    const ariClient = createAriEventClient();
    ariClient.on('StasisEnd', (event: { channel?: { id?: string } }) => {
      if (event.channel?.id === session.channelId) {
        session.call_ended_at = '2026-05-11T10:00:14.000Z';
      }
    });
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockImplementation(async () => {
        ariClient.emit('StasisEnd', { channel: { id: 'channel-1' } }, { id: 'channel-1' });
      }),
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Voicemail Subflow', current_version_id: 333, status: 'published' }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'voicemail-1', type: 'voicemail', label: 'Voicemail', config_json: {} },
          { node_key: 'webhook-1', type: 'webhook', label: 'Webhook', config_json: { url: 'https://example.com/voicemail' } },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { source_node_key: 'start', target_node_key: 'voicemail-1', branch_key: 'default', condition: null },
          { source_node_key: 'voicemail-1', target_node_key: 'webhook-1', branch_key: 'done', condition: 'done' },
        ];
      }
      return [];
    });

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('default')
      .mockImplementationOnce(async (_channel, _node, activeSession) => {
        activeSession.webhookPayload.recording = {
          url: 'http://127.0.0.1:3001/recordings/777/download',
          duration_seconds: 14,
        };
        activeSession.webhookPayload.outcome = { status: 'completed' };
        return 'done';
      });

    await expect(runFlow(channel as never, session, ariClient as never)).resolves.toEqual({ status: 'completed' });
    expect(executeNodeMock).toHaveBeenCalledTimes(4);
    expect(executeNodeMock.mock.calls.map((call) => call[1]?.nodeKey)).not.toContain('after-sub');
    expect(fireWebhookAsyncMock).toHaveBeenCalledTimes(1);
    expect(fireWebhookAsyncMock.mock.calls[0]?.[0]?.nodeKey).toBe('webhook-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[2]?.nodeKey).toBe('voicemail-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[1]?.call_ended_at).toBe('2026-05-11T10:00:14.000Z');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[1]?.webhookPayload).toEqual({
      recording: {
        url: 'http://127.0.0.1:3001/recordings/777/download',
        duration_seconds: 14,
      },
      outcome: { status: 'completed' },
    });
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('fires transfer webhook edge from the transfer node after done instead of returning to parent menu', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        config: {
          branches: ['1'],
          submenu_branch_flows: {
            '1': { flowId: 222, name: 'transfer_subflow' },
          },
        },
      },
      { nodeKey: 'after-sub', type: 'play_audio', label: 'After Subflow', config: {} },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'after-sub', branchKey: 'complete', condition: 'complete' },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Transfer Subflow', current_version_id: 333, status: 'published' }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'transfer-1', type: 'transfer', label: 'Transfer', config_json: {} },
          { node_key: 'webhook-1', type: 'webhook', label: 'Webhook', config_json: { url: 'https://example.com/transfer' } },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { source_node_key: 'start', target_node_key: 'transfer-1', branch_key: 'default', condition: null },
          { source_node_key: 'transfer-1', target_node_key: 'webhook-1', branch_key: 'done', condition: 'done' },
        ];
      }
      return [];
    });

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('default')
      .mockImplementationOnce(async (_channel, _node, activeSession) => {
        activeSession.webhookPayload.recording = {
          url: 'http://127.0.0.1:3001/recordings/888/download',
          duration_seconds: 21,
        };
        activeSession.webhookPayload.outcome = { status: 'completed' };
        return 'done';
      });

    await expect(runFlow(channel as never, session, {})).resolves.toEqual({ status: 'completed' });
    expect(executeNodeMock).toHaveBeenCalledTimes(4);
    expect(executeNodeMock.mock.calls.map((call) => call[1]?.nodeKey)).not.toContain('after-sub');
    expect(fireWebhookAsyncMock).toHaveBeenCalledTimes(1);
    expect(fireWebhookAsyncMock.mock.calls[0]?.[0]?.nodeKey).toBe('webhook-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[2]?.nodeKey).toBe('transfer-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[1]?.webhookPayload).toEqual({
      recording: {
        url: 'http://127.0.0.1:3001/recordings/888/download',
        duration_seconds: 21,
      },
      outcome: { status: 'completed' },
    });
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('fires hunt webhook edge from the hunt node after done instead of returning to parent menu', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        config: {
          branches: ['1'],
          submenu_branch_flows: {
            '1': { flowId: 222, name: 'hunt_subflow' },
          },
        },
      },
      { nodeKey: 'after-sub', type: 'play_audio', label: 'After Subflow', config: {} },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'after-sub', branchKey: 'complete', condition: 'complete' },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM call_flows') && sql.includes('WHERE id = $1')) {
        return [{ id: 222, name: 'Hunt Subflow', current_version_id: 333, status: 'published' }];
      }
      if (sql.includes('SELECT node_key, type, label, config_json') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
          { node_key: 'hunt-1', type: 'hunt', label: 'Hunt', config_json: {} },
          { node_key: 'webhook-1', type: 'webhook', label: 'Webhook', config_json: { url: 'https://example.com/hunt' } },
        ];
      }
      if (sql.includes('SELECT source_node_key, target_node_key, branch_key, condition') && sql.includes('WHERE flow_version_id = $1')) {
        return [
          { source_node_key: 'start', target_node_key: 'hunt-1', branch_key: 'default', condition: null },
          { source_node_key: 'hunt-1', target_node_key: 'webhook-1', branch_key: 'done', condition: 'done' },
        ];
      }
      return [];
    });

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('default')
      .mockImplementationOnce(async (_channel, _node, activeSession) => {
        activeSession.webhookPayload.recording = {
          url: 'http://127.0.0.1:3001/recordings/777/download',
          duration_seconds: 14,
        };
        activeSession.webhookPayload.outcome = { status: 'completed' };
        return 'done';
      });

    await expect(runFlow(channel as never, session, {})).resolves.toEqual({ status: 'completed' });
    expect(executeNodeMock).toHaveBeenCalledTimes(4);
    expect(executeNodeMock.mock.calls.map((call) => call[1]?.nodeKey)).not.toContain('after-sub');
    expect(fireWebhookAsyncMock).toHaveBeenCalledTimes(1);
    expect(fireWebhookAsyncMock.mock.calls[0]?.[0]?.nodeKey).toBe('webhook-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[2]?.nodeKey).toBe('hunt-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[1]?.webhookPayload).toEqual({
      recording: {
        url: 'http://127.0.0.1:3001/recordings/777/download',
        duration_seconds: 14,
      },
      outcome: { status: 'completed' },
    });
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });

  it('fires callback webhook edge from the callback node after done', async () => {
    const session = createSession();
    session.flow.nodes = [
      { nodeKey: 'start', type: 'start', label: 'Start', config: {} },
      { nodeKey: 'callback-1', type: 'callback', label: 'Callback', config: {} },
      { nodeKey: 'webhook-1', type: 'webhook', label: 'Webhook', config: { url: 'https://example.com/callback' } },
    ];
    session.flow.edges = [
      { sourceNodeKey: 'start', targetNodeKey: 'callback-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'callback-1', targetNodeKey: 'webhook-1', branchKey: 'done', condition: 'done' },
    ];
    const channel = {
      id: 'channel-1',
      hangup: jest.fn().mockResolvedValue(undefined),
    };

    executeNodeMock
      .mockResolvedValueOnce('default')
      .mockImplementationOnce(async (_channel, _node, activeSession) => {
        activeSession.webhookPayload.callback = {
          number: '781100996',
          source: 'dtmf',
        };
        activeSession.webhookPayload.outcome = { status: 'completed' };
        return 'done';
      });

    await expect(runFlow(channel as never, session, {})).resolves.toEqual({ status: 'completed' });
    expect(executeNodeMock).toHaveBeenCalledTimes(2);
    expect(fireWebhookAsyncMock).toHaveBeenCalledTimes(1);
    expect(fireWebhookAsyncMock.mock.calls[0]?.[0]?.nodeKey).toBe('webhook-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[2]?.nodeKey).toBe('callback-1');
    expect(fireWebhookAsyncMock.mock.calls[0]?.[1]?.webhookPayload).toEqual({
      callback: {
        number: '781100996',
        source: 'dtmf',
      },
      outcome: { status: 'completed' },
    });
    expect(channel.hangup).toHaveBeenCalledTimes(1);
  });
});
