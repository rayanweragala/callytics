import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

describe('Trunks API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /trunks creates a trunk and returns 201 with id, name, host, port', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer()).post('/trunks').send({ name: 'Test Trunk', host: '127.0.0.1', port: 5060 });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: 'Test Trunk',
      host: '127.0.0.1',
      port: 5060,
    }));
  });

  it('GET /trunks returns array including the created trunk', async () => {
    const app = await getApp();
    await request(app.getHttpServer()).post('/trunks').send({ name: 'Listed Trunk', host: '127.0.0.1', port: 5060 });

    const response = await request(app.getHttpServer()).get('/trunks');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Listed Trunk' }),
    ]));
  });

  it('PUT /trunks/:id updates host field and returns updated trunk', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/trunks').send({ name: 'Update Trunk', host: '127.0.0.1', port: 5060 });

    const response = await request(app.getHttpServer())
      .put(`/trunks/${created.body.data.id}`)
      .send({ host: '192.0.2.10' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.objectContaining({ host: '192.0.2.10' }));
  });

  it('POST /trunks/:id/test returns graceful error response for unreachable host', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/trunks').send({ name: 'Probe Trunk', host: '203.0.113.1', port: 65000 });

    const response = await request(app.getHttpServer()).post(`/trunks/${created.body.data.id}/test`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('unreachable');
    expect(typeof response.body.message).toBe('string');
    expect(response.body.message.toLowerCase()).not.toBe('ok');
    expect(response.body.rtt_ms).toBeNull();
  });

  it('DELETE /trunks/:id returns 204', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer()).post('/trunks').send({ name: 'Delete Trunk', host: '127.0.0.1', port: 5060 });

    const response = await request(app.getHttpServer()).delete(`/trunks/${created.body.data.id}`);

    expect(response.status).toBe(204);
  });
});
