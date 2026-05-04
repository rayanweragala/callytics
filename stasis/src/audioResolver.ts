import { query } from './db';

function toAsteriskSoundPath(storagePathConverted: string): string {
  const parts = storagePathConverted.split('/');
  const filename = parts[parts.length - 1] || '';
  const basename = filename.replace(/\.[^.]+$/, '');
  return `callytics/${basename}`;
}

export async function resolveAudioMediaPath(config: Record<string, unknown>, idField: string, pathField: string): Promise<string | null> {
  const audioId = Number(config[idField] || 0);

  if (audioId > 0) {
    const rows = await query(
      `SELECT storage_path_converted FROM audio_files WHERE id = $1 AND conversion_status = 'ready' LIMIT 1`,
      [audioId],
    );

    const convertedPath = rows[0]?.storage_path_converted as string | undefined;

    if (convertedPath) {
      const soundPath = toAsteriskSoundPath(convertedPath);
      return soundPath;
    }
  }

  const rawPath = String(config[pathField] || '').trim();
  return rawPath || null;
}
