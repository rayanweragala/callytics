import { stasisLogger } from "./logger";
import { addSession, createSession, removeSession } from './callSession';
import { query } from './db';
import { loadFlowById } from './flowLoader';
import { getPublisher, getSubscriber, publish } from './redis';
import { runFlow } from './runtime';
import { publishCallEvent } from './telemetry';
import { formatDialNumber } from './lib/formatDialNumber';
import { fetchTrunkDialFormat } from './lib/trunkResolver';

const ARI_URL = process.env.ARI_URL || 'http://127.0.0.1:8088';
const ARI_USER = process.env.ARI_USER || 'callytics';
const ARI_PASS = process.env.ARI_PASS || 'callytics';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:3001';

interface CampaignRecord {
  id: number;
  name: string;
  status: string;
  flowId: number | null;
  trunkId: number | null;
  callerId: string | null;
  trunkName: string | null;
  trunkCallerId: string | null;
  maxConcurrent: number;
  maxRetries: number;
  retryIntervalMinutes: number;
}

interface CampaignContact {
  id: number;
  phoneNumber: string;
  name: string | null;
  attempts: number;
}

interface ActiveCall {
  campaignId: number;
  contact: CampaignContact;
  phoneNumber: string;
  startedAt: string;
  attemptNumber: number;
  flowRan: boolean;
}

interface CampaignRuntime {
  campaign: CampaignRecord;
  queue: CampaignContact[];
  activeByChannel: Map<string, ActiveCall>;
  stopRequested: boolean;
  dialedCount: number;
  answeredCount: number;
  failedCount: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CampaignExecutor {
  private readonly runtimes = new Map<number, CampaignRuntime>();
  private subscriberReady = false;

  async start(): Promise<void> {
    const redis = await getSubscriber();
    if (this.subscriberReady) {
      return;
    }

    await redis.pSubscribe('campaign:start:*', async (_message, channel) => {
      const campaignId = Number(channel.split(':').pop() || 0);
      if (campaignId > 0) {
        await this.startCampaign(campaignId);
      }
    });

    await redis.pSubscribe('campaign:stop:*', async (_message, channel) => {
      const campaignId = Number(channel.split(':').pop() || 0);
      if (campaignId > 0) {
        await this.stopCampaign(campaignId);
      }
    });

    this.subscriberReady = true;
    stasisLogger.log('[campaign] subscribed to campaign:start:* and campaign:stop:*');
  }

  async handleStasisStart(
    event: { args?: string[]; channel?: { caller?: { number?: string } } },
    channel: { id: string; answer: () => Promise<void>; hangup: () => Promise<void> },
    ariClient: unknown,
  ): Promise<boolean> {
    if (event.args?.[0] !== 'campaign') {
      return false;
    }

    const campaignId = Number(event.args[1] || 0);
    const contactId = Number(event.args[2] || 0);
    if (!campaignId || !contactId) {
      return false;
    }

    const runtime = this.runtimes.get(campaignId);
    if (!runtime) {
      stasisLogger.warn(`[campaign] runtime missing for campaign ${campaignId}`);
      try {
        await channel.hangup();
      } catch {}
      return true;
    }

    const active = runtime.activeByChannel.get(channel.id);
    if (!active) {
      return true;
    }

    await publish('campaign:contact:update', {
      campaignId,
      contactId,
      status: 'dialing',
    });

    const flowId = runtime.campaign.flowId;
    if (!flowId) {
      await publishCallEvent({
        callId: channel.id,
        timestamp: new Date().toISOString(),
        type: 'failed',
        caller: runtime.campaign.trunkCallerId || '',
        destination: active.phoneNumber,
        direction: 'outbound',
        failureReason: 'campaign flow missing',
      });
      try {
        await channel.hangup();
      } catch {}
      return true;
    }

    const flow = await loadFlowById(flowId);
    if (!flow) {
      await publishCallEvent({
        callId: channel.id,
        timestamp: new Date().toISOString(),
        type: 'failed',
        caller: runtime.campaign.trunkCallerId || '',
        destination: active.phoneNumber,
        direction: 'outbound',
        flowId,
        failureReason: 'campaign flow not found',
      });
      try {
        await channel.hangup();
      } catch {}
      return true;
    }

    const entryNode = flow.nodes.find((node) => node.type === 'start') || flow.nodes[0];
    const session = createSession(channel.id, active.phoneNumber, flow, entryNode.nodeKey);
    session.variables.direction = 'outbound';
    addSession(session);

    try {
      await publishCallEvent({
        callId: channel.id,
        timestamp: new Date().toISOString(),
        type: 'started',
        caller: runtime.campaign.trunkCallerId || '',
        destination: active.phoneNumber,
        direction: 'outbound',
        flowId: flow.id,
        flowVersionId: flow.versionId,
        entryNodeKey: entryNode.nodeKey,
      });

      await channel.answer();
      active.flowRan = true;
      await runFlow(channel, session, ariClient).catch(async (error) => {
        stasisLogger.error('[campaign] runFlow error:', error);
        await publishCallEvent({
          callId: channel.id,
          timestamp: new Date().toISOString(),
          type: 'failed',
          caller: runtime.campaign.trunkCallerId || '',
          destination: active.phoneNumber,
          direction: 'outbound',
          flowId: flow.id,
          flowVersionId: flow.versionId,
          failureReason: error instanceof Error ? error.message : 'unknown runtime error',
        });
      });
    } catch (error) {
      stasisLogger.error('[campaign] outbound flow setup failed:', error);
    }

    return true;
  }

  async handleChannelEnd(channelId: string, causeText?: string): Promise<boolean> {
    let foundCampaignId: number | null = null;
    let runtime: CampaignRuntime | null = null;
    let active: ActiveCall | null = null;

    for (const entry of Array.from(this.runtimes.entries())) {
      const campaignId = entry[0];
      const candidate = entry[1];
      const hit = candidate.activeByChannel.get(channelId);
      if (hit) {
        foundCampaignId = campaignId;
        runtime = candidate;
        active = hit;
        break;
      }
    }

    if (!runtime || !active || !foundCampaignId) {
      return false;
    }

    runtime.activeByChannel.delete(channelId);
    await this.decrementActive(foundCampaignId);

    const outcome = this.determineOutcome(active, causeText);
    if (outcome === 'answered') {
      runtime.answeredCount += 1;
    }

    let finalStatus: string = outcome;
    const shouldRetry = ['busy', 'no_answer'].includes(outcome)
      && active.attemptNumber <= runtime.campaign.maxRetries;

    if (shouldRetry) {
      finalStatus = 'pending';
      const retryRuntime = runtime;
      const retryContact = { ...active.contact };
      const retryAttemptNumber = active.attemptNumber;
      setTimeout(() => {
        retryRuntime.queue.push({
          ...retryContact,
          attempts: retryAttemptNumber,
        });
        void this.fillWindow(retryRuntime);
      }, retryRuntime.campaign.retryIntervalMinutes * 60_000);
    } else if (outcome === 'busy' || outcome === 'no_answer' || outcome === 'failed') {
      runtime.failedCount += 1;
    }

    const callLogId = await this.findCallLogId(channelId);
    if (callLogId === null) {
      stasisLogger.warn(`[campaign] call_log lookup failed after retries for channel=${channelId}; publishing contact update with null callLogId`);
    }
    await publish('campaign:contact:update', {
      campaignId: foundCampaignId,
      contactId: active.contact.id,
      status: finalStatus,
      outcome,
      callLogId,
      callId: channelId,
      attemptNumber: active.attemptNumber,
      startedAt: active.startedAt,
      endedAt: new Date().toISOString(),
      retryAfterMinutes: runtime.campaign.retryIntervalMinutes,
    });

    await publish('campaign:stats:update', {
      campaignId: foundCampaignId,
      dialedCount: runtime.dialedCount,
      answeredCount: runtime.answeredCount,
      failedCount: runtime.failedCount,
    });

    removeSession(channelId);

    if (!runtime.stopRequested) {
      await this.fillWindow(runtime);
    }

    if (runtime.activeByChannel.size === 0 && runtime.queue.length === 0) {
      if (runtime.stopRequested) {
        await publish('campaign:cancelled', { campaignId: foundCampaignId });
      } else {
        await publish('campaign:completed', { campaignId: foundCampaignId });
      }
      this.runtimes.delete(foundCampaignId);
      const redis = await getPublisher();
      await redis.del(`campaign:active:${foundCampaignId}`).catch(() => undefined);
    }

    return true;
  }

  private async startCampaign(campaignId: number): Promise<void> {
    const campaign = await this.fetchCampaign(campaignId);
    if (!campaign || !campaign.flowId || !campaign.trunkId) {
      stasisLogger.warn(`[campaign] cannot start campaign ${campaignId}: missing flow/trunk`);
      return;
    }

    const contacts = await this.fetchPendingContacts(campaignId);
    const runtime: CampaignRuntime = {
      campaign,
      queue: [...contacts],
      activeByChannel: new Map(),
      stopRequested: false,
      dialedCount: 0,
      answeredCount: 0,
      failedCount: 0,
    };

    this.runtimes.set(campaignId, runtime);

    const redis = await getPublisher();
    await redis.set(`campaign:active:${campaignId}`, '0');

    await this.fillWindow(runtime);
  }

  private async stopCampaign(campaignId: number): Promise<void> {
    const runtime = this.runtimes.get(campaignId);
    if (!runtime) {
      return;
    }

    runtime.stopRequested = true;
    if (runtime.activeByChannel.size === 0) {
      await publish('campaign:cancelled', { campaignId });
      this.runtimes.delete(campaignId);
    }
  }

  private async fillWindow(runtime: CampaignRuntime): Promise<void> {
    while (!runtime.stopRequested && runtime.activeByChannel.size < runtime.campaign.maxConcurrent && runtime.queue.length > 0) {
      const contact = runtime.queue.shift();
      if (!contact) {
        break;
      }
      await this.dialContact(runtime, contact);
    }
  }

  private async dialContact(runtime: CampaignRuntime, contact: CampaignContact): Promise<void> {
    const dialFormat = await fetchTrunkDialFormat(runtime.campaign.trunkId || 0);
    const formattedNumber = formatDialNumber(contact.phoneNumber, dialFormat);

    if (!formattedNumber) {
      stasisLogger.error(`[campaign] invalid number format campaign=${runtime.campaign.id} contact=${contact.id} format=${dialFormat}`);
      runtime.failedCount += 1;
      await publish('campaign:contact:update', {
        campaignId: runtime.campaign.id,
        contactId: contact.id,
        status: 'failed',
        outcome: 'failed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
      return;
    }

    const endpoint = `PJSIP/${formattedNumber}@trunk-${runtime.campaign.trunkId}`;
    const appArgs = `campaign,${runtime.campaign.id},${contact.id}`;
    const callerId = runtime.campaign.callerId
      || runtime.campaign.trunkCallerId
      || undefined;

    try {
      const response = await fetch(`${ARI_URL.replace(/\/$/, '')}/ari/channels`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${ARI_USER}:${ARI_PASS}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint,
          app: 'callytics',
          appArgs,
          ...(callerId ? { callerId } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`originate_failed status=${response.status} body=${body}`);
      }

      const payload = (await response.json()) as { id?: string };
      const channelId = String(payload.id || '');
      if (!channelId) {
        throw new Error('originate did not return channel id');
      }

      runtime.dialedCount += 1;
      runtime.activeByChannel.set(channelId, {
        campaignId: runtime.campaign.id,
        contact,
        phoneNumber: contact.phoneNumber,
        startedAt: new Date().toISOString(),
        attemptNumber: Number(contact.attempts || 0) + 1,
        flowRan: false,
      });

      await this.incrementActive(runtime.campaign.id);
      await publish('campaign:contact:update', {
        campaignId: runtime.campaign.id,
        contactId: contact.id,
        status: 'dialing',
      });
      await publish('campaign:stats:update', {
        campaignId: runtime.campaign.id,
        dialedCount: runtime.dialedCount,
        answeredCount: runtime.answeredCount,
        failedCount: runtime.failedCount,
      });
    } catch (error) {
      stasisLogger.error(`[campaign] dial failed campaign=${runtime.campaign.id} contact=${contact.id}:`, error);
      runtime.failedCount += 1;
      await publish('campaign:contact:update', {
        campaignId: runtime.campaign.id,
        contactId: contact.id,
        status: 'failed',
        outcome: 'failed',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });
    }
  }

  private async fetchCampaign(campaignId: number): Promise<CampaignRecord | null> {
    const response = await fetch(`${BACKEND_URL}/campaigns/${campaignId}`);
    if (!response.ok) {
      return null;
    }
    const campaign = (await response.json()) as Record<string, unknown>;
    return {
      id: Number(campaign.id),
      name: String(campaign.name || ''),
      status: String(campaign.status || ''),
      flowId: campaign.flowId === null ? null : Number(campaign.flowId || 0),
      trunkId: campaign.trunkId === null ? null : Number(campaign.trunkId || 0),
      callerId: campaign.callerId ? String(campaign.callerId) : null,
      trunkName: campaign.trunkName ? String(campaign.trunkName) : null,
      trunkCallerId: campaign.trunkCallerId ? String(campaign.trunkCallerId) : null,
      maxConcurrent: Number(campaign.maxConcurrent || 1),
      maxRetries: Number(campaign.maxRetries || 0),
      retryIntervalMinutes: Number(campaign.retryIntervalMinutes || 30),
    };
  }

  private async fetchPendingContacts(campaignId: number): Promise<CampaignContact[]> {
    const response = await fetch(`${BACKEND_URL}/campaigns/${campaignId}/contacts?status=pending&limit=1000&offset=0`);
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { contacts?: Array<Record<string, unknown>> };
    return (payload.contacts || []).map((item) => ({
      id: Number(item.id || 0),
      phoneNumber: String(item.phoneNumber || ''),
      name: item.name ? String(item.name) : null,
      attempts: Number(item.attempts || 0),
    }));
  }

  private async findCallLogId(callUuid: string): Promise<number | null> {
    const maxAttempts = 3;
    const retryDelayMs = 500;

    for (let i = 0; i < maxAttempts; i += 1) {
      const rows = await query(
        `SELECT id FROM call_logs WHERE call_uuid = $1 ORDER BY id DESC LIMIT 1`,
        [callUuid],
      );
      const id = rows[0]?.id ? Number(rows[0].id) : null;
      if (id) {
        return id;
      }
      if (i < maxAttempts - 1) {
        await sleep(retryDelayMs);
      }
    }

    return null;
  }

  private determineOutcome(active: ActiveCall, causeText?: string): 'answered' | 'no_answer' | 'busy' | 'failed' {
    if (active.flowRan) {
      return 'answered';
    }

    const cause = String(causeText || '').toLowerCase();
    if (cause.includes('busy')) {
      return 'busy';
    }
    if (cause.includes('no answer') || cause.includes('no_answer') || cause.includes('cancel')) {
      return 'no_answer';
    }
    return 'failed';
  }

  private async incrementActive(campaignId: number): Promise<void> {
    const redis = await getPublisher();
    await redis.incr(`campaign:active:${campaignId}`).catch(() => undefined);
  }

  private async decrementActive(campaignId: number): Promise<void> {
    const redis = await getPublisher();
    await redis.decr(`campaign:active:${campaignId}`).catch(() => undefined);
  }
}
