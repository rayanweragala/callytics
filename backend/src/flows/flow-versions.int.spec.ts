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

function createMenuFlowPayload(name = 'Menu Flow') {
  return {
    name,
    description: 'Integration test flow with menu group',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      {
        nodeKey: 'menu-1',
        type: 'menu',
        label: 'Main Menu',
        positionX: 120,
        positionY: 0,
        config: {
          timeout_ms: 5000,
          branches: ['1', 'timeout', 'invalid'],
          prompt_audio_file_id: 1,
        },
      },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'menu-1', branchKey: 'default', condition: null }],
  };
}

describe('Flow Versions API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /flows/:id/versions reuses current version when snapshot is unchanged and list/detail return it', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Versioned Flow'));

    const committed = await request(app.getHttpServer())
      .post(`/flows/${created.body.data.id}/versions`)
      .send({ message: 'First save' });

    expect(committed.status).toBe(201);
    expect(committed.body.data).toEqual(expect.objectContaining({
      flowId: created.body.data.id,
      versionNum: 1,
      message: 'Saved from editor',
      nodeCount: 2,
    }));

    const listed = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}/versions`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: committed.body.data.id,
        flowId: created.body.data.id,
        versionNum: committed.body.data.versionNum,
        message: 'Saved from editor',
        nodeCount: 2,
      }),
    ]));

    const detailed = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}/versions/${committed.body.data.id}`);
    expect(detailed.status).toBe(200);
    expect(detailed.body.data).toEqual(expect.objectContaining({
      id: committed.body.data.id,
      flowId: created.body.data.id,
      versionNum: committed.body.data.versionNum,
      message: 'Saved from editor',
      nodeCount: 2,
      snapshot: expect.objectContaining({
        nodes: expect.any(Array),
        edges: expect.any(Array),
      }),
    }));
  });

  it('POST /flows creates visible committed versions for editor saves and PUT /flows/:id creates a new root version', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Saved Flow'));
    const flowId = created.body.data.id;

    const initialVersions = await request(app.getHttpServer()).get(`/flows/${flowId}/versions`);
    expect(initialVersions.status).toBe(200);
    expect(initialVersions.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        flowId,
        versionNum: 1,
        message: 'Saved from editor',
        nodeCount: 2,
      }),
    ]));

    const updatedPayload = {
      ...createFlowPayload('Saved Flow Updated'),
      name: 'Saved Flow Updated',
      nodes: [
        { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
        { nodeKey: 'menu', type: 'get_digits', label: 'Main Menu', positionX: 150, positionY: 0, config: { timeout_ms: 5000 } },
        { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 300, positionY: 0, config: {} },
      ],
      edges: [
        { sourceNodeKey: 'start', targetNodeKey: 'menu', branchKey: 'default', condition: null },
        { sourceNodeKey: 'menu', targetNodeKey: 'hangup', branchKey: 'default', condition: 'default' },
      ],
    };

    const updated = await request(app.getHttpServer())
      .put(`/flows/${flowId}`)
      .send(updatedPayload);
    expect(updated.status).toBe(200);

    const listedAfterUpdate = await request(app.getHttpServer()).get(`/flows/${flowId}/versions`);
    expect(listedAfterUpdate.status).toBe(200);
    expect(listedAfterUpdate.body.data).toHaveLength(2);
    expect(listedAfterUpdate.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        flowId,
        versionNum: 2,
        message: 'Saved from editor',
        nodeCount: 3,
      }),
      expect.objectContaining({
        flowId,
        versionNum: 1,
        message: 'Saved from editor',
        nodeCount: 2,
      }),
    ]));
  });

  it('POST /flows/:id/versions/:versionId/restore restores snapshot as current flow state', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Restore Flow'));
    const flowId = created.body.data.id;

    const committed = await request(app.getHttpServer())
      .post(`/flows/${flowId}/versions`)
      .send({ message: 'Initial committed state' });

    const updatedPayload = {
      ...createFlowPayload('Restore Flow Updated'),
      name: 'Restore Flow Updated',
      nodes: [
        { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
        { nodeKey: 'menu', type: 'get_digits', label: 'Main Menu', positionX: 150, positionY: 0, config: { timeout_ms: 5000 } },
        { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 300, positionY: 0, config: {} },
      ],
      edges: [
        { sourceNodeKey: 'start', targetNodeKey: 'menu', branchKey: 'default', condition: null },
        { sourceNodeKey: 'menu', targetNodeKey: 'hangup', branchKey: 'default', condition: 'default' },
      ],
    };

    const updated = await request(app.getHttpServer())
      .put(`/flows/${flowId}`)
      .send(updatedPayload);
    expect(updated.status).toBe(200);
    expect(updated.body.data.nodes).toHaveLength(3);

    const restored = await request(app.getHttpServer())
      .post(`/flows/${flowId}/versions/${committed.body.data.id}/restore`)
      .send({});
    expect(restored.status).toBe(201);
    expect(restored.body).toEqual({ data: { success: true } });

    const fetched = await request(app.getHttpServer()).get(`/flows/${flowId}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.data.name).toBe('Restore Flow');
    expect(fetched.body.data.nodes.length).toBeGreaterThanOrEqual(2); // Restored to initial committed state
    expect(fetched.body.data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'start' }),
      expect.objectContaining({ nodeKey: 'hangup' }),
    ]));
  });

  it('restoring root version also rolls subflow current version back to snapshot state', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createMenuFlowPayload('Root With Subflow'));
    expect(created.status).toBe(201);

    const rootFlowId = created.body.data.id as number;
    const menuNode = created.body.data.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'menu-1');
    const subflowId = Number(menuNode?.subflowId || 0);
    expect(subflowId).toBeGreaterThan(0);

    const subflowFetched = await request(app.getHttpServer()).get(`/flows/${subflowId}`);
    expect(subflowFetched.status).toBe(200);

    const updateSubflowToA = await request(app.getHttpServer())
      .put(`/flows/${subflowId}`)
      .send({
        name: subflowFetched.body.data.name,
        description: 'A',
        slug: subflowFetched.body.data.slug,
        parentFlowId: subflowFetched.body.data.parentFlowId,
        parentNodeKey: subflowFetched.body.data.parentNodeKey,
        nodes: [
          { nodeKey: 'start', type: 'start', label: 'Start A', positionX: 0, positionY: 0, config: {} },
          { nodeKey: 'hangup', type: 'hangup', label: 'Hangup A', positionX: 200, positionY: 0, config: {} },
        ],
        edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null }],
      });
    expect(updateSubflowToA.status).toBe(200);

    const versionsAfterA = await request(app.getHttpServer()).get(`/flows/${rootFlowId}/versions`);
    expect(versionsAfterA.status).toBe(200);
    const rootVersionAfterA = versionsAfterA.body.data.find((item: { versionNum: number }) => item.versionNum === 2);
    expect(rootVersionAfterA).toBeDefined();

    const updateSubflowToB = await request(app.getHttpServer())
      .put(`/flows/${subflowId}`)
      .send({
        name: subflowFetched.body.data.name,
        description: 'B',
        slug: subflowFetched.body.data.slug,
        parentFlowId: subflowFetched.body.data.parentFlowId,
        parentNodeKey: subflowFetched.body.data.parentNodeKey,
        nodes: [
          { nodeKey: 'start', type: 'start', label: 'Start B', positionX: 0, positionY: 0, config: {} },
          { nodeKey: 'hangup', type: 'hangup', label: 'Hangup B', positionX: 200, positionY: 0, config: {} },
        ],
        edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null }],
      });
    expect(updateSubflowToB.status).toBe(200);

    const restore = await request(app.getHttpServer())
      .post(`/flows/${rootFlowId}/versions/${rootVersionAfterA.id}/restore`)
      .send({});
    expect(restore.status).toBe(201);

    const subflowAfterRestore = await request(app.getHttpServer()).get(`/flows/${subflowId}`);
    expect(subflowAfterRestore.status).toBe(200);
    expect(subflowAfterRestore.body.data.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: 'start', label: 'Start A' }),
      expect.objectContaining({ nodeKey: 'hangup', label: 'Hangup A' }),
    ]));
    expect(subflowAfterRestore.body.data.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Start B' }),
      expect.objectContaining({ label: 'Hangup B' }),
    ]));
  });

});
