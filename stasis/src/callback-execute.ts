import { stasisLogger } from "./logger";
import { publish } from './redis';
import { publishSipTraffic } from './telemetry';
import {
  registerCallbackWaiter,
  rejectCallbackWaiter,
  type CallbackWaiterResult,
} from './callbackManager';

const DEFAULT_CALLBACK_MOH_CLASS =
  process.env.CALLBACK_MOH_CLASS || process.env.QUEUE_LOGIN_MOH_CLASS || 'callytics-hold';

export interface CallbackExecutePayload {
  callbackId: number;
  customerNumber?: string;
  customerTrunkId?: number | null;
  customerDialString?: string;
  operatorDialString: string;
  callerIdNumber: string;
}

interface AriChannel {
  id: string;
  hangup: () => Promise<void>;
}

interface AriClient {
  channels: {
    originate: (params: {
      endpoint: string;
      app: string;
      appArgs: string;
      callerId: string;
      timeout: number;
    }) => Promise<{ id?: string } | void>;
    startMoh?: (params: { channelId: string; mohClass?: string }) => Promise<void>;
    stopMoh?: (params: { channelId: string }) => Promise<void>;
  };
  bridges: {
    create: (params: { type: string }) => Promise<{ id: string }>;
    addChannel: (params: { bridgeId: string; channel: string }) => Promise<void>;
    destroy: (params: { bridgeId: string }) => Promise<void>;
  };
  on: (event: string, listener: (event: { channel?: { id?: string } }) => void) => void;
  removeListener: (event: string, listener: (event: { channel?: { id?: string } }) => void) => void;
}

function waitForAnsweredLeg(
  callbackId: number,
  leg: 'operator' | 'customer',
  timeoutMs: number,
): Promise<CallbackWaiterResult> {
  const waitForAnswer = registerCallbackWaiter(callbackId, leg);

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectCallbackWaiter(callbackId, leg, 'timeout');
      resolve({ answered: false, reason: 'timeout' });
    }, timeoutMs);

    waitForAnswer
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ answered: false, reason: 'failed' });
      });
  });
}

function waitForChannelEnd(
  ariClient: AriClient,
  channelIds: string[],
): Promise<string> {
  return new Promise((resolve) => {
    const onEnd = (event: { channel?: { id?: string } }) => {
      const endedChannelId = String(event.channel?.id || '').trim();
      if (!endedChannelId || !channelIds.includes(endedChannelId)) {
        return;
      }
      cleanup();
      resolve(endedChannelId);
    };

    const cleanup = () => {
      ariClient.removeListener('StasisEnd', onEnd);
      ariClient.removeListener('ChannelDestroyed', onEnd);
    };

    ariClient.on('StasisEnd', onEnd);
    ariClient.on('ChannelDestroyed', onEnd);
  });
}

async function publishStatus(
  callbackId: number,
  status: string,
  failReason?: string,
): Promise<void> {
  await publish('callback:status:update', {
    callbackId,
    status,
    ...(failReason ? { failReason } : {}),
  });
}

async function publishCallbackSipTraffic(params: {
  callId: string;
  method: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  responseCode?: number | null;
  rawMessage: string;
}): Promise<void> {
  await publishSipTraffic({
    callId: params.callId,
    timestamp: new Date().toISOString(),
    method: params.method,
    from: params.from,
    to: params.to,
    direction: params.direction,
    responseCode: params.responseCode ?? null,
    rawMessage: params.rawMessage,
  });
}

function normalizeSriLankanTrunkEndpoint(endpoint: string): string {
  const trimmed = String(endpoint || '').trim();
  const match = /^PJSIP\/([^@]+)@trunk-(\d+)$/i.exec(trimmed);
  if (!match) {
    return trimmed;
  }

  const numberPart = String(match[1] || '').trim();
  if (!/^0\d{9}$/.test(numberPart)) {
    return trimmed;
  }

  const normalized = `+94${numberPart.slice(1)}`;
  return `PJSIP/${normalized}@trunk-${match[2]}`;
}

async function startOperatorHoldAudio(ariClient: AriClient, channelId: string): Promise<boolean> {
  if (!ariClient.channels.startMoh) {
    stasisLogger.warn(`[callback] hold audio start unavailable channel=${channelId}`);
    return false;
  }
  try {
    await ariClient.channels.startMoh({ channelId, mohClass: DEFAULT_CALLBACK_MOH_CLASS });
    stasisLogger.log(`[callback] hold audio started channel=${channelId} class=${DEFAULT_CALLBACK_MOH_CLASS}`);
    return true;
  } catch (error) {
    stasisLogger.warn(`[callback] hold audio start failed channel=${channelId}:`, error);
    return false;
  }
}

async function stopOperatorHoldAudio(ariClient: AriClient, channelId: string): Promise<void> {
  if (!ariClient.channels.stopMoh) {
    return;
  }
  try {
    await ariClient.channels.stopMoh({ channelId });
    stasisLogger.log(`[callback] hold audio stopped channel=${channelId}`);
  } catch {
    // ARI channels can be destroyed before stop completes — safe to ignore.
  }
}

export async function executeCallback(
  ariClientRaw: unknown,
  payload: CallbackExecutePayload,
): Promise<void> {
  const ariClient = ariClientRaw as AriClient;
  const appName = process.env.ARI_APP || 'callytics';
  const callbackId = Number(payload.callbackId || 0);
  const rawCustomerDialString = String(payload.customerDialString || '').trim()
    || (
      payload.customerNumber && payload.customerTrunkId
        ? `PJSIP/${payload.customerNumber}@trunk-${payload.customerTrunkId}`
        : ''
    );
  const customerDialString = normalizeSriLankanTrunkEndpoint(rawCustomerDialString);
  if (customerDialString !== rawCustomerDialString) {
    stasisLogger.log(
      `[callback] normalized customer endpoint callback_id=${callbackId} from=${rawCustomerDialString} to=${customerDialString}`,
    );
  }

  if (!callbackId || !payload.operatorDialString || !customerDialString || !payload.callerIdNumber) {
    stasisLogger.error('[callback] execute skipped: missing required fields', {
      callbackId,
      hasOperatorDialString: Boolean(payload.operatorDialString),
      hasCustomerDialString: Boolean(customerDialString),
      hasCallerIdNumber: Boolean(payload.callerIdNumber),
    });
    return;
  }

  let operatorChannel: AriChannel | null = null;
  let holdAudioStarted = false;
  const operatorSipCallId = `callback-${callbackId}-operator`;
  const customerSipCallId = `callback-${callbackId}-customer`;
  try {
    stasisLogger.log(
      `[callback] start callback_id=${callbackId} operator_endpoint=${payload.operatorDialString} customer_endpoint=${customerDialString}`,
    );
    stasisLogger.log(`[callback] dialing operator callback_id=${callbackId} endpoint=${payload.operatorDialString}`);
    await publishCallbackSipTraffic({
      callId: operatorSipCallId,
      method: 'INVITE',
      direction: 'outbound',
      from: payload.callerIdNumber,
      to: payload.operatorDialString,
      responseCode: null,
      rawMessage: `INVITE ${payload.operatorDialString} SIP/2.0`,
    }).catch((error) => {
      stasisLogger.error('[callback] sip traffic publish failed (operator INVITE):', error);
    });
    await ariClient.channels.originate({
      endpoint: payload.operatorDialString,
      app: appName,
      appArgs: `callback-operator,${callbackId}`,
      callerId: payload.callerIdNumber,
      timeout: 30,
    });

    const operatorResult = await waitForAnsweredLeg(callbackId, 'operator', 30_000);
    if (operatorResult.answered === false) {
      stasisLogger.log(`[callback] operator unanswered callback_id=${callbackId} reason=${operatorResult.reason}`);
      await publishCallbackSipTraffic({
        callId: operatorSipCallId,
        method: '408 Request Timeout',
        direction: 'inbound',
        from: payload.operatorDialString,
        to: payload.callerIdNumber,
        responseCode: 408,
        rawMessage: 'SIP/2.0 408 Request Timeout',
      }).catch((error) => {
        stasisLogger.error('[callback] sip traffic publish failed (operator timeout):', error);
      });
      await publishStatus(callbackId, 'failed', 'operator_no_answer');
      return;
    }

    operatorChannel = operatorResult.channel;
    await publishCallbackSipTraffic({
      callId: operatorSipCallId,
      method: '200 OK',
      direction: 'inbound',
      from: payload.operatorDialString,
      to: payload.callerIdNumber,
      responseCode: 200,
      rawMessage: 'SIP/2.0 200 OK',
    }).catch((error) => {
      stasisLogger.error('[callback] sip traffic publish failed (operator answer):', error);
    });
    stasisLogger.log(`[callback] operator answered callback_id=${callbackId} channel=${operatorChannel.id}`);
    holdAudioStarted = await startOperatorHoldAudio(ariClient, operatorChannel.id);
    await publishStatus(callbackId, 'dialing_customer');

    stasisLogger.log(`[callback] dialing customer callback_id=${callbackId} endpoint=${customerDialString}`);
    await publishCallbackSipTraffic({
      callId: customerSipCallId,
      method: 'INVITE',
      direction: 'outbound',
      from: payload.callerIdNumber,
      to: customerDialString,
      responseCode: null,
      rawMessage: `INVITE ${customerDialString} SIP/2.0`,
    }).catch((error) => {
      stasisLogger.error('[callback] sip traffic publish failed (customer INVITE):', error);
    });
    await ariClient.channels.originate({
      endpoint: customerDialString,
      app: appName,
      appArgs: `callback-customer,${callbackId}`,
      callerId: payload.callerIdNumber,
      timeout: 30,
    });

    const customerResult = await waitForAnsweredLeg(callbackId, 'customer', 30_000);
    if (customerResult.answered === false) {
      stasisLogger.log(`[callback] customer unanswered callback_id=${callbackId} reason=${customerResult.reason}`);
      await publishCallbackSipTraffic({
        callId: customerSipCallId,
        method: '408 Request Timeout',
        direction: 'inbound',
        from: customerDialString,
        to: payload.callerIdNumber,
        responseCode: 408,
        rawMessage: 'SIP/2.0 408 Request Timeout',
      }).catch((error) => {
        stasisLogger.error('[callback] sip traffic publish failed (customer timeout):', error);
      });
      if (holdAudioStarted) {
        await stopOperatorHoldAudio(ariClient, operatorChannel.id);
        holdAudioStarted = false;
      }
      await operatorChannel.hangup().catch(() => undefined);
      await publishStatus(callbackId, 'failed', 'customer_no_answer');
      return;
    }

    const customerChannel: AriChannel = customerResult.channel;
    await publishCallbackSipTraffic({
      callId: customerSipCallId,
      method: '200 OK',
      direction: 'inbound',
      from: customerDialString,
      to: payload.callerIdNumber,
      responseCode: 200,
      rawMessage: 'SIP/2.0 200 OK',
    }).catch((error) => {
      stasisLogger.error('[callback] sip traffic publish failed (customer answer):', error);
    });
    stasisLogger.log(`[callback] customer answered callback_id=${callbackId} channel=${customerChannel.id}`);
    if (holdAudioStarted) {
      await stopOperatorHoldAudio(ariClient, operatorChannel.id);
      holdAudioStarted = false;
    }
    await publishStatus(callbackId, 'bridged');

    const bridge = await ariClient.bridges.create({ type: 'mixing' });
    stasisLogger.log(
      `[callback] bridge created callback_id=${callbackId} bridge=${bridge.id} operator_channel=${operatorChannel.id} customer_channel=${customerChannel.id}`,
    );
    await ariClient.bridges.addChannel({ bridgeId: bridge.id, channel: operatorChannel.id });
    await ariClient.bridges.addChannel({ bridgeId: bridge.id, channel: customerChannel.id });

    const endedChannelId = await waitForChannelEnd(ariClient, [operatorChannel.id, customerChannel.id]);
    const survivingChannel = endedChannelId === operatorChannel.id ? customerChannel : operatorChannel;
    stasisLogger.log(
      `[callback] leg ended callback_id=${callbackId} ended_channel=${endedChannelId} surviving_channel=${survivingChannel.id}`,
    );

    await survivingChannel.hangup().catch(() => undefined);
    await ariClient.bridges.destroy({ bridgeId: bridge.id }).catch(() => undefined);
    stasisLogger.log(`[callback] bridge destroyed callback_id=${callbackId} bridge=${bridge.id}`);

    await publishStatus(callbackId, 'completed');
    stasisLogger.log(`[callback] completed callback_id=${callbackId}`);
  } catch (error) {
    if (holdAudioStarted && operatorChannel) {
      await stopOperatorHoldAudio(ariClient, operatorChannel.id);
    }
    await publishStatus(callbackId, 'failed', 'originate_failed');
    stasisLogger.error('[callback] execute failed:', error);
  }
}
