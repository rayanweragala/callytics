import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

function createFlowPayload(name = 'Route Flow') {
  return {
    name,
    description: 'Inbound route flow',
    nodes: [
      { nodeKey: 'start', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
      { nodeKey: 'hangup', type: 'hangup', label: 'Hangup', positionX: 100, positionY: 0, config: {} },
    ],
    edges: [{ sourceNodeKey: 'start', targetNodeKey: 'hangup', branchKey: 'default', condition: null }],
  };
}

describe('Inbound routes API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function createFlowId(app: Awaited<ReturnType<typeof getApp>>): Promise<number> {
    const createdFlow = await request(app.getHttpServer()).post('/flows').send(createFlowPayload());
    return createdFlow.body.data.id;
  }

  it('POST /inbound-routes creates a route and returns 201 with id, did, flowId', async () => {
    const app = await getApp();
    const flowId = await createFlowId(app);

    const response = await request(app.getHttpServer())
      .post('/inbound-routes')
      .send({ did: '1234', flowId, label: 'Main DID' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      did: '1234',
      flowId,
    }));
  });

  it('GET /inbound-routes returns array including the created route', async () => {
    const app = await getApp();
    const flowId = await createFlowId(app);
    await request(app.getHttpServer()).post('/inbound-routes').send({ did: '1234', flowId, label: 'Main DID' });

    const response = await request(app.getHttpServer()).get('/inbound-routes');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ did: '1234', flowId }),
    ]));
  });

  it('PUT /inbound-routes/:id updates did and returns updated route', async () => {
    const app = await getApp();
    const flowId = await createFlowId(app);
    const created = await request(app.getHttpServer()).post('/inbound-routes').send({ did: '1234', flowId, label: 'Main DID' });

    const response = await request(app.getHttpServer())
      .put(`/inbound-routes/${created.body.data.id}`)
      .send({ did: '5678' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ did: '5678' }));
  });

  it('DELETE /inbound-routes/:id returns 200 and subsequent list does not include deleted route', async () => {
    const app = await getApp();
    const flowId = await createFlowId(app);
    const created = await request(app.getHttpServer()).post('/inbound-routes').send({ did: '1234', flowId, label: 'Main DID' });

    const removed = await request(app.getHttpServer()).delete(`/inbound-routes/${created.body.data.id}`);
    const listed = await request(app.getHttpServer()).get('/inbound-routes');

    expect(removed.status).toBe(200);
    expect(listed.body.data.find((item: { id: number }) => item.id === created.body.data.id)).toBeUndefined();
  });
});
