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
  });

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

  it('DELETE /flows/:id returns 200 and subsequent GET returns 404', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/flows').send(createFlowPayload('Delete Flow'));

    const deleted = await request(app.getHttpServer()).delete(`/flows/${created.body.data.id}`);
    const fetched = await request(app.getHttpServer()).get(`/flows/${created.body.data.id}`);

    expect(deleted.status).toBe(200);
    expect(fetched.status).toBe(404);
  });
});
