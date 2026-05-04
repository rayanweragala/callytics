import { resolveAudioMediaPath } from './audioResolver';
import { query } from './db';

jest.mock('./db', () => ({
  query: jest.fn(),
}));

describe('resolveAudioMediaPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('known audio_file_id returns the correct Asterisk sound path', async () => {
    (query as jest.Mock).mockResolvedValue([{ storage_path_converted: '/var/audio/test-sound.wav' }]);
    const result = await resolveAudioMediaPath({ my_id: 123, fallback: 'path/fallback' }, 'my_id', 'fallback');
    expect(query).toHaveBeenCalledWith(expect.any(String), [123]);
    expect(result).toBe('callytics/test-sound');
  });

  it('unknown audio_file_id returns the raw fallback path', async () => {
    (query as jest.Mock).mockResolvedValue([]);
    const result = await resolveAudioMediaPath({ my_id: 999, fallback: 'path/fallback' }, 'my_id', 'fallback');
    expect(result).toBe('path/fallback');
  });

  it('null or undefined input does not throw and returns fallback or null', async () => {
    const result = await resolveAudioMediaPath({}, 'my_id', 'fallback');
    expect(query).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
