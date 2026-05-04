import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, getTestDb, truncateAll } from '../../test/helpers';

async function seedTemplateFlow(app: Awaited<ReturnType<typeof getApp>>): Promise<number> {
  const createResponse = await request(app.getHttpServer())
    .post('/flows')
    .send({
      name: 'Seed Template',
      description: 'Template seed',
      nodes: [
        { nodeKey: 'start_1', type: 'start', label: 'Start', positionX: 0, positionY: 0, config: {} },
        { nodeKey: 'hangup_1', type: 'hangup', label: 'Hangup', positionX: 100, positionY: 0, config: {} },
      ],
      edges: [{ sourceNodeKey: 'start_1', targetNodeKey: 'hangup_1', branchKey: 'default', condition: null }],
    });

  const flowId = Number(createResponse.body.data.id);
  const db = await getTestDb();
  await db.query(
    `
      UPDATE call_flows
      SET is_template = true,
          template_description = 'Template description',
          template_category = 'clinic'
      WHERE id = $1
    `,
    [flowId],
  );

  return flowId;
}

describe('Templates API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('GET /templates returns template flows with node_count', async () => {
    const app = await getApp();
    const templateFlowId = await seedTemplateFlow(app);

    const response = await request(app.getHttpServer()).get('/templates');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: templateFlowId,
        templateCategory: 'clinic',
        nodeCount: expect.any(Number),
      }),
    ]));
  });

  it('POST /templates/:id/import copies template into a new non-template flow', async () => {
    const app = await getApp();
    const templateFlowId = await seedTemplateFlow(app);

    const response = await request(app.getHttpServer())
      .post(`/templates/${templateFlowId}/import`)
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: expect.stringContaining('(copy)'),
    }));

    const copiedFlow = await request(app.getHttpServer()).get(`/flows/${response.body.data.id}`);
    expect(copiedFlow.status).toBe(200);
    expect(copiedFlow.body.data.nodes.length).toBe(2);
    expect(copiedFlow.body.data.edges.length).toBe(1);
  });
});
