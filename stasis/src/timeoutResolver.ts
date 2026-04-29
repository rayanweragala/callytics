import { CallSession } from './callSession';
import { FlowNode } from './flowLoader';

const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
export const INTER_DIGIT_TIMEOUT_MS = 4000;

export function parseValidTimeoutMs(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < MIN_TIMEOUT_MS || numeric > MAX_TIMEOUT_MS) return null;
  return numeric;
}

export function resolveFlowDefaultTimeoutMs(session: CallSession): number | null {
  const startNode = session.flow.nodes.find((node) => node.type === 'start');
  if (!startNode) return null;
  return parseValidTimeoutMs(startNode.config.flow_default_timeout_ms ?? startNode.config.queue_login_default_input_timeout_ms);
}

export function resolveNodeTimeoutMs(node: FlowNode, session: CallSession, fallbackMs: number): number {
  const nodeTimeoutMs = parseValidTimeoutMs(node.config.timeout_ms);
  const flowDefaultTimeoutMs = resolveFlowDefaultTimeoutMs(session);
  return nodeTimeoutMs ?? flowDefaultTimeoutMs ?? fallbackMs;
}
