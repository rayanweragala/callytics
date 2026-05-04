import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

describe('Queues API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /queues creates queue and returns 201 with id and name', async () => {
    const app = await getApp();
    const op = await request(app.getHttpServer()).post('/operators').send({ name: 'Alice' });
    const response = await request(app.getHttpServer())
      .post('/queues')
      .send({ name: 'Support', max_wait_seconds: 120, pin_retry_attempts: 3, operator_ids: [op.body.data.id] });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: 'Support',
    }));
  });

  it('GET /queues returns array including created queue', async () => {
    const app = await getApp();
    const op = await request(app.getHttpServer()).post('/operators').send({ name: 'Alice' });
    await request(app.getHttpServer())
      .post('/queues')
      .send({ name: 'Support', max_wait_seconds: 120, pin_retry_attempts: 3, operator_ids: [op.body.data.id] });

    const response = await request(app.getHttpServer()).get('/queues');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Support' }),
    ]));
  });

  it('PATCH /queues/:id updates queue name', async () => {
    const app = await getApp();
    const op = await request(app.getHttpServer()).post('/operators').send({ name: 'Alice' });
    const created = await request(app.getHttpServer())
      .post('/queues')
      .send({ name: 'Support', max_wait_seconds: 120, pin_retry_attempts: 3, operator_ids: [op.body.data.id] });

    const response = await request(app.getHttpServer())
      .patch(`/queues/${created.body.data.id}`)
      .send({ name: 'Updated' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Updated');
  });

  it('DELETE /queues/:id removes queue', async () => {
    const app = await getApp();
    const op = await request(app.getHttpServer()).post('/operators').send({ name: 'Alice' });
    const created = await request(app.getHttpServer())
      .post('/queues')
      .send({ name: 'Support', max_wait_seconds: 120, pin_retry_attempts: 3, operator_ids: [op.body.data.id] });

    const removed = await request(app.getHttpServer()).delete(`/queues/${created.body.data.id}`);
    expect([200, 204]).toContain(removed.status);

    const list = await request(app.getHttpServer()).get('/queues');
    expect(list.body.data.find((item: { id: number }) => item.id === created.body.data.id)).toBeUndefined();
  });

  it('POST /queues returns 400 when name is missing', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer())
      .post('/queues')
      .send({});

    expect(response.status).toBe(400);
  });
});
