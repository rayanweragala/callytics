import { stasisLogger } from "../logger";
import type { RedisClientType } from 'redis';
import { computeMos, type RtcpDirection, worseDirection } from '../lib/mosScore';

const STREAM_KEY = 'callytics:rtp-quality';
const STREAM_MAX = '1000';

export const accumulator = new Map<string, RtcpDirection>();

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function handleAmiRtcpEvent(message: Record<string, string>, redis: RedisClientType): void {
  if (message.Event !== 'RTCPReceived' && message.Event !== 'RTCPSent') {
    return;
  }

  const callId = message.Uniqueid ?? null;

  const jitterSamples = parseNumber(message.Report0IAJitter);

  // FractionLost is 0-255 (scaled fraction), convert to percentage
  const fractionLost = parseNumber(message.Report0FractionLost);
  const packetLoss = fractionLost !== null ? (fractionLost / 255) * 100 : 0;

  const rttSeconds = parseNumber(message.RTT) ?? 0;

  if (!callId || jitterSamples === null) {
    stasisLogger.warn('[rtcp-ami] missing callId or jitter — skipping');
    return;
  }

  const direction: RtcpDirection = {
    jitter: jitterSamples / 8,
    packetLoss,
    rtt: rttSeconds * 1000,
  };

  if (accumulator.has(callId)) {
    const final = worseDirection(accumulator.get(callId) as RtcpDirection, direction);
    accumulator.delete(callId);

    const { mos, grade } = computeMos(final);
    const payload = {
      callId,
      mos,
      jitter: final.jitter,
      packetLoss: final.packetLoss,
      rtt: final.rtt,
      grade,
      recordedAt: new Date().toISOString(),
    };

    void (async () => {
      try {
        await redis.xAdd(STREAM_KEY, '*', {
          data: JSON.stringify(payload),
        });
        await redis.xTrim(STREAM_KEY, 'MAXLEN', parseInt(STREAM_MAX, 10));
      } catch (err) {
        stasisLogger.error('[rtcp-ami] redis publish failed:', err);
      }
    })();

    return;
  }

  accumulator.set(callId, direction);
}
