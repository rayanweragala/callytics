import axios from 'axios';

export const BACKEND_UNREACHABLE_MESSAGE =
  'Unable to reach backend. Please check server connection and try again.';

/**
 * Extracts a human-readable message from an API error.
 * Prefers the body `message` field returned by NestJS over the axios status string.
 */
export function getApiError(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (!error.response || error.code === 'ERR_NETWORK') {
      return BACKEND_UNREACHABLE_MESSAGE;
    }
    const bodyMessage = error.response?.data?.message;
    if (typeof bodyMessage === 'string' && bodyMessage.length > 0) return bodyMessage;
    if (Array.isArray(bodyMessage) && bodyMessage.length > 0) return bodyMessage[0];
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
