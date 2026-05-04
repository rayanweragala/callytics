import { promises as fs } from 'fs';
import request from 'supertest';
import { AudioService } from './audio.service';
import { closeApp, getApp } from '../../test/app';
import { closeTestDb, truncateAll } from '../../test/helpers';

describe('Audio API', () => {
  afterAll(async () => {
    await closeApp();
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    jest.restoreAllMocks();
  });

  it('GET /audio returns an array', async () => {
    const app = await getApp();
    const response = await request(app.getHttpServer()).get('/audio');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('POST /audio/tts creates a TTS audio file with text, voice, speed and returns 201 with id, filename, url fields', async () => {
    const app = await getApp();
    const audioService = app.get(AudioService);

    jest.spyOn(audioService as any, 'ensureVoice').mockResolvedValue(undefined);
    jest.spyOn(audioService as any, 'processAudio').mockImplementation(async (id: number, inputPath: string) => ({
      id,
      name: 'Prompt',
      sourceType: 'tts',
      originalFilename: inputPath.split('/').pop() || `${id}.wav`,
      mimeType: 'audio/wav',
      durationMs: 1500,
      storagePathOriginal: inputPath,
      storagePathConverted: `/tmp/${id}.wav`,
      storagePathPreview: `/tmp/${id}-preview.wav`,
      conversionStatus: 'ready',
      ttsText: 'Hello from test',
      ttsVoice: 'en_US-lessac-medium',
      speed: 1.2,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    jest.spyOn(audioService as any, 'runCommand').mockResolvedValue({ stdout: '', stderr: '' });

    const response = await request(app.getHttpServer())
      .post('/audio/tts')
      .send({ name: 'Prompt', text: 'Hello from test', voice: 'en_US-lessac-medium', speed: 1.2 });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: 'Prompt',
      originalFilename: expect.any(String),
      originalUrl: expect.stringMatching(/^\/media\//),
      convertedUrl: expect.stringMatching(/^\/media\//),
      previewUrl: null,
    }));
  });

  it('POST /audio/tts/preview returns audio/wav and does not create a DB record', async () => {
    const app = await getApp();
    const audioService = app.get(AudioService);
    const before = await request(app.getHttpServer()).get('/audio');

    jest.spyOn(audioService, 'previewTts').mockImplementation(async (_text, _voice, _speed, _pitch, _normalizeVolume, res: any) => {
      res.write(Buffer.from('RIFFfakeWAVE'));
      res.end();
    });

    const response = await request(app.getHttpServer())
      .post('/audio/tts/preview')
      .send({ text: 'Preview me', voice: 'en_US-lessac-medium', speed: 1.1, pitch: 2, normalizeVolume: true });
    const after = await request(app.getHttpServer()).get('/audio');

    expect(response.status).toBe(200);
    expect(String(response.headers['content-type'] || '')).toContain('audio/wav');
    expect(after.body.total).toBe(before.body.total);
  });

  it('POST /audio/upload accepts multipart upload and returns 201 with id and urls', async () => {
    const app = await getApp();
    const audioService = app.get(AudioService);
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);
    jest.spyOn(audioService as any, 'processAudio').mockImplementation(async (id: number, inputPath: string) => ({
      id,
      name: 'Upload Test',
      sourceType: 'upload',
      originalFilename: 'test.wav',
      mimeType: 'audio/wav',
      durationMs: 1000,
      storagePathOriginal: inputPath,
      storagePathConverted: `/tmp/${id}.wav`,
      storagePathPreview: `/tmp/${id}-preview.wav`,
      conversionStatus: 'ready',
      ttsText: null,
      ttsVoice: null,
      speed: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const response = await request(app.getHttpServer())
      .post('/audio/upload')
      .field('name', 'Upload Test')
      .attach('file', Buffer.from('RIFFfakeWAVE'), 'test.wav');

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: 'Upload Test',
      originalFilename: 'test.wav',
      originalUrl: expect.stringMatching(/^\/media\//),
      convertedUrl: expect.stringMatching(/^\/media\//),
      previewUrl: null,
    }));
  });

  it('DELETE /audio/:id returns 200 and subsequent GET /audio/:id returns 404', async () => {
    const app = await getApp();
    const audioService = app.get(AudioService);

    jest.spyOn(audioService as any, 'ensureVoice').mockResolvedValue(undefined);
    jest.spyOn(audioService as any, 'processAudio').mockImplementation(async (id: number, inputPath: string) => ({
      id,
      name: 'Delete Me',
      sourceType: 'tts',
      originalFilename: inputPath.split('/').pop() || `${id}.wav`,
      mimeType: 'audio/wav',
      durationMs: 1500,
      storagePathOriginal: inputPath,
      storagePathConverted: `/tmp/${id}.wav`,
      storagePathPreview: `/tmp/${id}-preview.wav`,
      conversionStatus: 'ready',
      ttsText: 'Delete me',
      ttsVoice: 'en_US-lessac-medium',
      speed: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    jest.spyOn(audioService as any, 'runCommand').mockResolvedValue({ stdout: '', stderr: '' });

    const created = await request(app.getHttpServer())
      .post('/audio/tts')
      .send({ name: 'Delete Me', text: 'Delete me', voice: 'en_US-lessac-medium', speed: 1 });

    const removed = await request(app.getHttpServer()).delete(`/audio/${created.body.data.id}`);
    const fetched = await request(app.getHttpServer()).get(`/audio/${created.body.data.id}`);

    expect(removed.status).toBe(200);
    expect(fetched.status).toBe(404);
  });
});
