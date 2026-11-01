import { getAriCredentials } from './asterisk-credentials';

describe('getAriCredentials', () => {
  it('reads ARI_PASS', () => {
    expect(getAriCredentials({ ARI_USER: 'ari', ARI_PASS: 'secret' })).toEqual({ user: 'ari', password: 'secret' });
  });

  it('also accepts ARI_PASSWORD', () => {
    expect(getAriCredentials({ ARI_PASSWORD: 'legacy' }).password).toBe('legacy');
  });

  it('prefers ARI_PASS when both are set and ignores empty values', () => {
    expect(getAriCredentials({ ARI_PASS: 'new', ARI_PASSWORD: 'old' }).password).toBe('new');
    expect(getAriCredentials({ ARI_PASS: '', ARI_PASSWORD: 'old' }).password).toBe('old');
  });

  it('falls back to the defaults', () => {
    expect(getAriCredentials({})).toEqual({ user: 'callytics', password: 'callytics' });
  });
});
