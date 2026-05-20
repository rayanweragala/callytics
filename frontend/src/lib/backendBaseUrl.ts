function normalizeConfiguredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

function tryGetOrigin(value: string): string | null {
  try {
    const base = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';
    const parsed = new URL(value, base);
    if (!parsed.protocol || !parsed.host) {
      return null;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function getApiBaseUrl(): string {
  const configured = normalizeConfiguredValue(import.meta.env.VITE_API_BASE_URL);
  if (configured) {
    return configured;
  }
  return '/api';
}

export function getSocketBaseUrl(): string | undefined {
  const configured = normalizeConfiguredValue(import.meta.env.VITE_SOCKET_BASE_URL);
  return configured ?? undefined;
}

export function getSocketPath(): string {
  const configured = normalizeConfiguredValue(import.meta.env.VITE_SOCKET_PATH);
  return configured || '/socket.io';
}

export function getMediaBaseUrl(): string {
  const configured = normalizeConfiguredValue(import.meta.env.VITE_MEDIA_BASE_URL);
  if (configured) {
    return configured;
  }
  const apiConfigured = normalizeConfiguredValue(import.meta.env.VITE_API_BASE_URL);
  if (!apiConfigured) {
    return '';
  }
  return tryGetOrigin(apiConfigured) ?? '';
}
