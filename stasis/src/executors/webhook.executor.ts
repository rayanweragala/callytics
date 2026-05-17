import { stasisLogger } from "../logger";
import { CallSession } from '../callSession';
import { FlowNode } from '../flowLoader';
import { publish } from '../redis';
import { resolveNodeTimeoutMs } from '../timeoutResolver';
import { buildWebhookPayload } from '../webhookPayload';

interface WebhookConfig {
  url?: string;
  method?: 'GET' | 'POST';
  include_session_variables?: boolean;
  timeout_ms?: number;
  headers?: Array<{ key: string; value: string }>;
  retry_enabled?: boolean;
  max_attempts?: number;
  retry_on_5xx?: boolean;
  retry_on_timeout?: boolean;
  retry_on_4xx?: boolean;
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
  const retryEnabled = config.retry_enabled !== false;
  const maxAttempts = Number.isFinite(config.max_attempts) && Number(config.max_attempts) > 0
    ? Number(config.max_attempts)
    : 3;
  const retryOn5xx = config.retry_on_5xx !== false;
  const retryOnTimeout = config.retry_on_timeout !== false;
  const retryOn4xx = config.retry_on_4xx === true;

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

  const requestBody = typeof fetchOptions.body === 'string' ? fetchOptions.body : '';

  void (async () => {
    let httpStatus: number | null = null;
    let responseBody: string | null = null;
    let success = false;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(url, fetchOptions);
      httpStatus = response.status;
      responseBody = truncateText(await response.text(), 500);
      success = response.ok;
      if (response.ok) {
        stasisLogger.log(`[webhook] fired url=${url} status=${response.status}`);
      } else {
        stasisLogger.warn(`[webhook] failed url=${url} status=${response.status}`);
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);
      errorMessage = message;
      stasisLogger.warn(`[webhook] ${isAbort ? 'timeout' : 'failed'} url=${url} err=${message}`);
    } finally {
      clearTimeout(timer);
      try {
        await publish('webhook:delivery', {
          flow_id: session.flow?.id ?? null,
          node_id: webhookNode.nodeKey,
          call_id: session.channelId,
          url,
          method,
          headers,
          body: requestBody,
          attempt_number: 1,
          http_status: httpStatus,
          response_body: responseBody,
          success,
          error_message: errorMessage,
          retry_enabled: retryEnabled,
          max_attempts: maxAttempts,
          retry_on_5xx: retryOn5xx,
          retry_on_timeout: retryOnTimeout,
          retry_on_4xx: retryOn4xx,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stasisLogger.warn(`[webhook] publish failed url=${url} err=${message}`);
      }
    }
  })();
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
