jest.mock('./nodes', () => ({
  executeNode: jest.fn(),
}));

jest.mock('./db', () => ({
  query: jest.fn().mockResolvedValue([]),
}));

import { executeNode } from './nodes';
import { query } from './db';
import { runFlow } from './runtime';
import type { CallSession } from './callSession';

const executeNodeMock = executeNode as jest.MockedFunction<typeof executeNode>;
const queryMock = query as jest.MockedFunction<typeof query>;

function createSession(): CallSession {
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '1000',
    currentNodeKey: 'start',
    variables: {},
    startedAt: new Date(),
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
});
