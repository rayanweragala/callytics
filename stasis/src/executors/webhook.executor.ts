import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { resolveNodeTimeoutMs } from '../timeoutResolver';

interface WebhookConfig {
  url?: string;
  method?: 'GET' | 'POST';
  include_caller?: boolean;
  include_digits?: boolean;
  timeout_ms?: number;
  headers?: Array<{ key: string; value: string }>;
}

export function fireWebhookAsync(
  node: FlowNode,
  session: CallSession,
): void {
  const config = (node.config || {}) as WebhookConfig;
  const url = String(config.url || '').trim();
  const method = config.method === 'GET' ? 'GET' : 'POST';
  const timeoutMs = resolveNodeTimeoutMs(node, session, 5000);

  if (!url) {
    console.warn('[webhook] no URL configured, skipping async fire');
    return;
  }

  const payload: Record<string, unknown> = {
    caller_number: session.callerNumber,
    flow_id: session.flow.id,
    timestamp: new Date().toISOString(),
  };

  if (config.include_digits) {
    payload['variables'] = { ...session.variables };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (Array.isArray(config.headers)) {
    for (const header of config.headers) {
      const key = String(header.key || '').trim();
      const value = String(header.value || '').trim();
      if (key) headers[key] = value;
    }
  }

  if (config.include_caller) {
    headers['X-Caller-Number'] = session.callerNumber;
  }

  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (method === 'POST') {
        fetchOptions.body = JSON.stringify(payload);
      }

      const response = await fetch(url, fetchOptions);
      console.log(`[webhook] fired url=${url} status=${response.status}`);
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[webhook] ${isAbort ? 'timeout' : 'failed'} url=${url} err=${message}`);
    } finally {
      clearTimeout(timer);
    }
  })();
}
