import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

describe('Extensions API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /extensions creates an extension and returns 201 with id and username', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer())
      .post('/extensions')
      .send({ username: '1001', password: 'secret', displayName: 'Agent 1001' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      username: '1001',
    }));
  });

  it('GET /extensions returns array including the created extension', async () => {
    const app = await getApp();
    await request(app.getHttpServer())
      .post('/extensions')
      .send({ username: '1002', password: 'secret', displayName: 'Agent 1002' });

    const response = await request(app.getHttpServer()).get('/extensions');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ username: '1002' }),
    ]));
  });

  it('DELETE /extensions/:id returns 200 and subsequent list does not include deleted extension', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer())
      .post('/extensions')
      .send({ username: '1003', password: 'secret', displayName: 'Agent 1003' });

    const removed = await request(app.getHttpServer()).delete(`/extensions/${created.body.data.id}`);
    const list = await request(app.getHttpServer()).get('/extensions');

    expect(removed.status).toBe(200);
    expect(list.body.data.find((item: { id: number }) => item.id === created.body.data.id)).toBeUndefined();
  });
});
