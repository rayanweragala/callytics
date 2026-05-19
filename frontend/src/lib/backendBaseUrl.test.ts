import { describe, expect, it, vi, beforeEach } from 'vitest';

const loadModule = async (env: Record<string, string | undefined>) => {
  vi.resetModules();

  vi.stubEnv('VITE_API_BASE_URL', env.VITE_API_BASE_URL);
  vi.stubEnv('VITE_MEDIA_BASE_URL', env.VITE_MEDIA_BASE_URL);

  return await import('./backendBaseUrl');
};

describe('getApiBaseUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns configured API base URL without trailing slashes', async () => {
    const { getApiBaseUrl } = await loadModule({
      VITE_API_BASE_URL: 'http://localhost:8000///',
      VITE_MEDIA_BASE_URL: undefined,
    });

    expect(getApiBaseUrl()).toBe('http://localhost:8000');
  });

  it('returns /api when API base URL is not configured', async () => {
    const { getApiBaseUrl } = await loadModule({
      VITE_API_BASE_URL: '',
      VITE_MEDIA_BASE_URL: undefined,
    });

    expect(getApiBaseUrl()).toBe('/api');
  });
});

describe('getMediaBaseUrl', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns configured media base URL without trailing slashes', async () => {
    const { getMediaBaseUrl } = await loadModule({
      VITE_API_BASE_URL: undefined,
      VITE_MEDIA_BASE_URL: 'http://localhost:8000/media///',
    });

    expect(getMediaBaseUrl()).toBe('http://localhost:8000/media');
  });

  it('falls back to API origin when media URL is not configured', async () => {
    const { getMediaBaseUrl } = await loadModule({
      VITE_API_BASE_URL: 'http://localhost:8000/api',
      VITE_MEDIA_BASE_URL: '',
    });

    expect(getMediaBaseUrl()).toBe('http://localhost:8000');
  });

  it('returns empty string when neither media nor API URL is configured', async () => {
    const { getMediaBaseUrl } = await loadModule({
      VITE_API_BASE_URL: '',
      VITE_MEDIA_BASE_URL: undefined,
    });

    expect(getMediaBaseUrl()).toBe('');
  });
});