import request from 'supertest';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

describe('Operators API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('POST /operators creates operator and returns 201 with id, name, extension, contactNumber, and hasPIN', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer())
      .post('/operators')
      .send({ name: 'Alice' });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: 'Alice',
      extension: null,
      contactNumber: null,
      hasPIN: true,
    }));
  });

  it('GET /operators returns array including created operator', async () => {
    const app = await getApp();
    await request(app.getHttpServer())
      .post('/operators')
      .send({ name: 'Alice' });

    const response = await request(app.getHttpServer()).get('/operators');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Alice', hasPIN: true }),
    ]));
  });

  it('PUT /operators/:id updates name and allows PIN rotation', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer())
      .post('/operators')
      .send({ name: 'Alice' });

    const response = await request(app.getHttpServer())
      .put(`/operators/${created.body.data.id}`)
      .send({ name: 'Bob', pin: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Bob');
    expect(response.body.data.hasPIN).toBe(true);
  });

  it('DELETE /operators/:id removes operator', async () => {
    const app = await getApp();
    const created = await request(app.getHttpServer())
      .post('/operators')
      .send({ name: 'Alice' });

    const removed = await request(app.getHttpServer()).delete(`/operators/${created.body.data.id}`);
    expect([200, 204]).toContain(removed.status);

    const list = await request(app.getHttpServer()).get('/operators');
    expect(list.body.data.find((item: { id: number }) => item.id === created.body.data.id)).toBeUndefined();
  });

  it('POST /operators returns 400 when name is missing', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer())
      .post('/operators')
      .send({});

    expect(response.status).toBe(400);
  });
});
