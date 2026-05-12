import type { CallSession } from './callSession';
import { buildWebhookPayload } from './webhookPayload';

function createSession(): CallSession {
  const startedAt = new Date('2026-05-11T10:00:00.000Z');
  return {
    callUuid: 'call-1',
    channelId: 'channel-1',
    callerNumber: '94770000000',
    currentNodeKey: 'hunt-1',
    variables: {},
    webhookPayload: {},
    call_started_at: startedAt.toISOString(),
    call_ended_at: null,
    startedAt,
    recording: null,
    inboundBridge: null,
    flow: {
      id: 9,
      name: 'Webhook Flow',
      versionId: 3,
      nodes: [],
      edges: [],
    },
  };
}

describe('buildWebhookPayload', () => {
  it('rounds call_duration_seconds to the nearest second when both timestamps exist', () => {
    const session = createSession();
    session.call_ended_at = '2026-05-11T10:00:01.600Z';

    const payload = buildWebhookPayload(
      session,
      { nodeKey: 'hunt-1', type: 'hunt' },
      false,
    );

    expect(payload.call_started_at).toBe('2026-05-11T10:00:00.000Z');
    expect(payload.call_ended_at).toBe('2026-05-11T10:00:01.600Z');
    expect(payload.call_duration_seconds).toBe(2);
  });

  it('keeps call_duration_seconds null until both timestamps are present', () => {
    const session = createSession();

    const payload = buildWebhookPayload(
      session,
      { nodeKey: 'hunt-1', type: 'hunt' },
      false,
    );

    expect(payload.call_started_at).toBe('2026-05-11T10:00:00.000Z');
    expect(payload.call_ended_at).toBeNull();
    expect(payload.call_duration_seconds).toBeNull();
  });
});
