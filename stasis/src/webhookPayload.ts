import { CallSession } from './callSession';

interface SourceNode {
  type: string;
  nodeKey: string;
}

/**
 * Assembles the complete webhook POST body from the session and the node that
 * triggered the webhook. This is the single authoritative payload builder —
 * it must never be called from inside individual executors, only from the
 * webhook executor and the runtime post-completion webhook edge handler.
 */
export function buildWebhookPayload(
  session: CallSession,
  sourceNode: SourceNode,
  includeVariables: boolean,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const endedAt = session.call_ended_at ?? null;

  let callDurationSeconds: number | null = null;
  if (session.call_started_at && endedAt) {
    const startMs = new Date(session.call_started_at).getTime();
    const endMs = new Date(endedAt).getTime();
    const diff = endMs - startMs;
    if (Number.isFinite(diff) && diff >= 0) {
      callDurationSeconds = Math.round(diff / 1000);
    }
  }

  const payload: Record<string, unknown> = {
    caller_number: session.callerNumber,
    flow_id: session.flow.id,
    node_type: sourceNode.type,
    node_id: sourceNode.nodeKey,
    timestamp: now,
    call_started_at: session.call_started_at,
    call_ended_at: endedAt,
    call_duration_seconds: callDurationSeconds,
  };

  const wp = session.webhookPayload;

  if (wp.outcome !== undefined) {
    payload['outcome'] = wp.outcome;
  }
  if (wp.bridge !== undefined) {
    payload['bridge'] = wp.bridge;
  }
  if (wp.queue !== undefined) {
    payload['queue'] = wp.queue;
  }
  if (wp.recording !== undefined) {
    payload['recording'] = wp.recording;
  }
  if (wp.callback !== undefined) {
    payload['callback'] = wp.callback;
  }

  payload['variables'] = includeVariables ? { ...session.variables } : {};

  return payload;
}
