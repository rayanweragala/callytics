import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

function createFlowPayload(name = 'Test Flow') {
  return {
    name,
    description: 'Integration test flow',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 100, positionY: 0, config: {} },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null }],
  };
}

function createGroupedFlowPayload(name = 'Grouped Flow') {
  return {
    name,
    description: 'Integration test flow with node groups',
    nodes: [
      { nodeKey: 'group-1', type: 'group', label: 'Welcome', positionX: 20, positionY: 20, config: {}, groupId: null },
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 24, positionY: 44, config: {}, groupId: 'group-1' },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 220, positionY: 44, config: {}, groupId: 'group-1' },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null }],
  };
}

function createMenuFlowPayload(name = 'Menu Flow') {
  return {
    name,
    description: 'Integration test flow with menu group',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 120, positionY: 80, config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        positionX: 120,
        positionY: 240,
        config: {
          timeout_ms: 5000,
          branches: ['1', '2'],
          prompt_audio_file_id: 1,
        },
      },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 120, positionY: 400, config: {} },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'hangup', branchKey: '1', condition: '1' },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'hangup', branchKey: '2', condition: '2' },
    ],
  };
}

function createBranchSubmenuPayload(options: {
  name: string;
  parentFlowId: number;
  parentNodeKey: string;
  parentBranchKey: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
}) {
  return {
    name: options.name,
    description: `${options.name} branch submenu`,
    parentFlowId: options.parentFlowId,
    parentNodeKey: options.parentNodeKey,
    parentBranchKey: options.parentBranchKey,
    nodes: options.nodes ?? [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 180, positionY: 0, config: {} },
    ],
    edges: options.edges ?? [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null }],
  };
}

function createConferenceFlowPayload(name = 'Conference Flow') {
  return {
    name,
    description: 'Integration test flow with conference node',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      {
        nodeKey: 'conference-1',
        type: 'conference',
        label: 'Conference Room',
        positionX: 120,
        positionY: 0,
        config: {
          roomName: 'SalesRoom1',
          waitForModerator: false,
          moderatorType: null,
          moderatorId: null,
        },
      },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'conference-1', branchKey: 'default', condition: null }],
  };
}

function createVoicemailCallbackWebhookFlowPayload(name = 'Terminal Webhook Flow') {
  return {
    name,
    description: 'Integration test flow with terminal nodes wired to webhooks',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      {
        nodeKey: 'voicemail-1',
        type: 'voicemail',
        label: 'Voicemail',
        positionX: 160,
        positionY: 0,
        config: { start_audio_id: 1 },
      },
      {
        nodeKey: 'callback-1',
        type: 'callback',
        label: 'Callback',
        positionX: 160,
        positionY: 160,
        config: { number_source: 'ani', destination_value: '1001' },
      },
      {
        nodeKey: 'webhook-voicemail',
        type: 'webhook',
        label: 'Voicemail Webhook',
        positionX: 360,
        positionY: 0,
        config: { url: 'https://example.com/voicemail' },
      },
      {
        nodeKey: 'webhook-callback',
        type: 'webhook',
        label: 'Callback Webhook',
        positionX: 360,
        positionY: 160,
        config: { url: 'https://example.com/callback' },
      },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'voicemail-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'start', targetNodeKey: 'callback-1', branchKey: 'callback', condition: null },
      { sourceNodeKey: 'voicemail-1', targetNodeKey: 'webhook-voicemail', branchKey: 'webhook', condition: null },
      { sourceNodeKey: 'callback-1', targetNodeKey: 'webhook-callback', branchKey: 'webhook', condition: null },
    ],
  };
}

function createMenuWebhookFlowPayload(name = 'Menu Webhook Flow') {
  return {
    name,
    description: 'Integration test flow with menu group wired to webhook',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Menu Group',
        positionX: 160,
        positionY: 0,
        config: {
          timeout_ms: 5000,
          branches: ['1', '2'],
          prompt_audio_file_id: 1,
        },
      },
      {
        nodeKey: 'webhook-menu',
        type: 'webhook',
        label: 'Menu Webhook',
        positionX: 360,
        positionY: 0,
        config: { url: 'https://example.com/menu' },
      },
    ],
    edges: [
      { sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null },
      { sourceNodeKey: 'menu-1', targetNodeKey: 'webhook-menu', branchKey: 'webhook', condition: null },
    ],
  };
}

describe('Flows API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /flows creates a flow and returns 201 with id, name, slug', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer()).post('/flows').send(createFlowPayload());

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: 'Test Flow',
      slug: expect.any(String),
    }));
  }, 15000);

  it('POST /flows returns 400 if name is missing', async () => {
    const app = await getApp();
    const payload = createFlowPayload();
    delete payload.name;

    const response = await request(app.getHttpServer()).post('/flows').send(payload);

    expect(response.status).toBe(400);
  });

  it('GET /flows returns array including the created flow', async () => {
    const app = await getApp();
    await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Listed Flow'));

    const response = await request(app.getHttpServer()).get('/flows');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Listed Flow' }),
    ]));
  });

  it('GET /flows/:id returns the flow with nodes and edges arrays', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Detailed Flow'));

    const response = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: created.body.data.id,
      name: 'Detailed Flow',
      nodes: expect.any(Array),
      edges: expect.any(Array),
    }));
  });

  it('POST /flows accepts conference nodes and persists the node type', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer()).post('/flows').send(createConferenceFlowPayload());

    expect(response.status).toBe(201);
    expect(response.body.data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeKey: 'conference-1',
        type: 'conference',
        config: expect.objectContaining({
          roomName: 'SalesRoom1',
          waitForModerator: false,
        }),
      }),
    ]));
  });

  it('GET /flows/:id returns 404 for unknown id', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer()).get('/flows/999999');
    expect(response.status).toBe(404);
  });

  it('PUT /flows/:id updates the name and returns the updated flow', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Original Flow'));

    const response = await request(app.getHttpServer())
      .put(`/flows/${created.body.data.id}`)
      .send(createFlowPayload('Updated Flow'));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ name: 'Updated Flow' }));
  });

  it('PUT /flows/:id accepts voicemail and callback nodes wired to webhook nodes', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Original Flow'));

    const response = await request(app.getHttpServer())
      .put(`/flows/${created.body.data.id}`)
      .send(createVoicemailCallbackWebhookFlowPayload());

    expect(response.status).toBe(200);
    expect(response.body.data.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeKey: 'voicemail-1', targetNodeKey: 'webhook-voicemail' }),
      expect.objectContaining({ sourceNodeKey: 'callback-1', targetNodeKey: 'webhook-callback' }),
    ]));
  });

  it('PUT /flows/:id accepts a menu group node wired to a webhook node', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Original Flow'));

    const response = await request(app.getHttpServer())
      .put(`/flows/${created.body.data.id}`)
      .send(createMenuWebhookFlowPayload());

    expect(response.status).toBe(200);
    expect(response.body.data.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceNodeKey: 'menu-1', targetNodeKey: 'webhook-menu' }),
    ]));
  });

  it('persists and returns node group ids on create and fetch', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createGroupedFlowPayload());

    expect(created.status).toBe(201);
    expect(created.body.data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'group-1', type: 'group', groupId: null }),
      expect.objectContaining({ nodeKey: 'start', groupId: 'group-1' }),
      expect.objectContaining({ nodeKey: 'hangup', groupId: 'group-1' }),
    ]));

    const fetched = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body.data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'group-1', type: 'group', groupId: null }),
      expect.objectContaining({ nodeKey: 'start', groupId: 'group-1' }),
      expect.objectContaining({ nodeKey: 'hangup', groupId: 'group-1' }),
    ]));
  });

  it('creates branch submenus explicitly and exposes breadcrumb ancestry', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createMenuFlowPayload());

    expect(created.status).toBe(201);
    const menuNode = created.body.data.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'menu-1');
    expect(menuNode).toEqual(expect.objectContaining({
      nodeKey: 'menu-1',
      type: 'menu',
      subflowId: null,
      config: expect.objectContaining({
        submenu_branch_flows: {},
      }),
    }));

    const subflow = await request(app.getHttpServer())
      .post('/flows')
      .send(createBranchSubmenuPayload({
        name: 'Sales submenu',
        parentFlowId: created.body.data.id,
        parentNodeKey: 'menu-1',
        parentBranchKey: '1',
      }));

    expect(subflow.status).toBe(201);
    expect(subflow.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      parentFlowId: created.body.data.id,
      parentNodeKey: 'menu-1',
      parentBranchKey: '1',
      nodes: expect.arrayContaining([
        expect.objectContaining({ nodeKey: 'start', type: 'start' }),
      ]),
    }));

    const subflowId = Number(subflow.body.data.id);

    const breadcrumb = await request(app.getHttpServer()).get(`/flows/${subflowId}/breadcrumb`);

    expect(breadcrumb.status).toBe(200);
    expect(breadcrumb.body.data).toEqual([
      {
        flowId: created.body.data.id,
        flowName: created.body.data.name,
        parentNodeKey: null,
        parentNodeLabel: null,
        parentBranchKey: null,
      },
      {
        flowId: subflowId,
        flowName: subflow.body.data.name,
        parentNodeKey: 'menu-1',
        parentNodeLabel: 'Main Menu',
        parentBranchKey: '1',
      },
    ]);
  });

  it('GET /flows/:id/tree returns the nested branch submenu hierarchy from the root flow', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createMenuFlowPayload('Tree Root'));

    expect(created.status).toBe(201);
    const firstSubflow = await request(app.getHttpServer())
      .post('/flows')
      .send(createBranchSubmenuPayload({
        name: 'Main Menu Subflow',
        parentFlowId: created.body.data.id,
        parentNodeKey: 'menu-1',
        parentBranchKey: '1',
        nodes: [
          { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
          {
            nodeKey: 'menu-2',
            type: 'menu',
            label: 'HR Menu',
            positionX: 160,
            positionY: 0,
            config: { timeout_ms: 5000, branches: ['1', '2'], prompt_audio_file_id: 1 },
          },
        ],
        edges: [{ sourceNodeKey: 'start', targetNodeKey: 'menu-2', branchKey: 'default', condition: null }],
      }));

    expect(firstSubflow.status).toBe(201);
    const firstSubflowId = Number(firstSubflow.body.data.id);

    const nestedSubflow = await request(app.getHttpServer())
      .post('/flows')
      .send(createBranchSubmenuPayload({
        name: 'HR submenu',
        parentFlowId: firstSubflowId,
        parentNodeKey: 'menu-2',
        parentBranchKey: '2',
      }));

    expect(nestedSubflow.status).toBe(201);
    const nestedSubflowId = Number(nestedSubflow.body.data.id);

    const treeResponse = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}/tree`);

    expect(treeResponse.status).toBe(200);
    expect(treeResponse.body.data).toEqual({
      id: created.body.data.id,
      name: 'Tree Root',
      children: [
        {
          nodeKey: 'menu-1',
          nodeLabel: 'Main Menu',
          branchKey: '1',
          subflowId: firstSubflowId,
          name: 'Main Menu Subflow',
          children: [
            {
              nodeKey: 'menu-2',
              nodeLabel: 'HR Menu',
              branchKey: '2',
              subflowId: nestedSubflowId,
              name: 'HR submenu',
              children: [],
            },
          ],
        },
      ],
    });
  });

  it('DELETE /flows/:id returns 200 and subsequent GET returns 404', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Delete Flow'));

    const deleted = await request(app.getHttpServer()).delete(`/flows/${created.body.data.id}`);
    const fetched = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}`);

    expect(deleted.status).toBe(200);
    expect(fetched.status).toBe(404);
  });
});
