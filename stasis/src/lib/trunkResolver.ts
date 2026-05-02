import { logEvent } from '../logger';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

export async function fetchTrunkDialFormat(trunkId: number): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_URL}/trunks/${trunkId}`);
    if (!res.ok) {
      logEvent('TrunkDialFormatFetchFailed', { trunkId, status: res.status });
      return '{number}';
    }
    const payload = await res.json() as { data?: { dialFormat?: string }; dialFormat?: string };
    const trunk = payload?.data || payload;
    return trunk?.dialFormat || '{number}';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent('TrunkDialFormatFetchError', { trunkId, error: message });
    return '{number}';
  }
}
