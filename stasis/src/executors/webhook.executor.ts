import { stasisLogger } from "../logger";
import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { resolveNodeTimeoutMs } from '../timeoutResolver';
import { buildWebhookPayload } from '../webhookPayload';

interface WebhookConfig {
  url?: string;
  method?: 'GET' | 'POST';
  include_session_variables?: boolean;
  timeout_ms?: number;
  headers?: Array<{ key: string; value: string }>;
}

export function fireWebhookAsync(
  webhookNode: FlowNode,
  session: CallSession,
  sourceNode?: FlowNode,
): void {
  const config = (webhookNode.config || {}) as WebhookConfig;
  const url = String(config.url || '').trim();
  const method = config.method === 'GET' ? 'GET' : 'POST';
  const timeoutMs = resolveNodeTimeoutMs(webhookNode, session, 5000);
  const triggerNode = sourceNode || webhookNode;

  if (!url) {
    stasisLogger.warn('[webhook] no URL configured, skipping async fire');
    return;
  }

  const includeVariables = Boolean(config.include_session_variables);
  const payload = buildWebhookPayload(session, triggerNode, includeVariables);

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fetchOptions: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  if (method === 'POST') {
    fetchOptions.body = JSON.stringify(payload);
  }

  void fetch(url, fetchOptions)
    .then((response) => {
      stasisLogger.log(`[webhook] fired url=${url} status=${response.status}`);
    })
    .catch((error) => {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);
      stasisLogger.warn(`[webhook] ${isAbort ? 'timeout' : 'failed'} url=${url} err=${message}`);
    })
    .finally(() => {
      clearTimeout(timer);
    });
}
