import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { isValidPhoneNumber, parsePhoneNumber, type CountryCode } from 'libphonenumber-js';
import { createClient, type RedisClientType } from 'redis';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';

interface CampaignPayload {
  name?: string;
  flowId?: number | null;
  trunkId?: number | null;
  callerId?: string | null;
  defaultCountry?: string;
  scheduledAt?: string | null;
  maxConcurrent?: number;
  maxRetries?: number;
  retryIntervalMinutes?: number;
}

interface CampaignContactUpdateEvent {
  campaignId: number;
  contactId: number;
  status?: string;
  outcome?: 'answered' | 'no_answer' | 'busy' | 'failed' | 'cancelled' | 'completed';
  callLogId?: number | null;
  callId?: string;
  attemptNumber?: number;
  startedAt?: string;
  endedAt?: string;
  retryAfterMinutes?: number;
}

interface CampaignStatsUpdateEvent {
  campaignId: number;
  dialedCount: number;
  answeredCount: number;
  failedCount: number;
}

@Injectable()
export class CampaignsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(CampaignsService.name);
  private publisher: RedisClientType | null = null;
  private subscriber: RedisClientType | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.initRedis();
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.disconnect().catch(() => undefined);
    await this.publisher?.disconnect().catch(() => undefined);
  }

  async list(limit = 25, offset = 0): Promise<{ campaigns: Record<string, unknown>[]; total: number }> {
    const safeLimit = Math.min(100, Math.max(1, Number(limit || 25)));
    const safeOffset = Math.max(0, Number(offset || 0));

    const startedAt = Date.now();
    const [rows, totalRows] = await Promise.all([
      this.dataSource.query(
        `
          SELECT
            c.id,
            c.name,
            c.status,
            c.flow_id AS "flowId",
            c.trunk_id AS "trunkId",
            c.caller_id AS "callerId",
            c.default_country AS "defaultCountry",
            c.scheduled_at AS "scheduledAt",
            c.max_concurrent AS "maxConcurrent",
            c.max_retries AS "maxRetries",
            c.retry_interval_minutes AS "retryIntervalMinutes",
            c.total_contacts AS "totalContacts",
            c.dialed_count AS "dialedCount",
            c.answered_count AS "answeredCount",
            c.failed_count AS "failedCount",
            c.created_at AS "createdAt",
            c.updated_at AS "updatedAt",
            f.name AS "flowName",
            t.name AS "trunkName"
          FROM campaigns c
          LEFT JOIN call_flows f ON f.id = c.flow_id
          LEFT JOIN sip_trunks t ON t.id = c.trunk_id
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT $1 OFFSET $2
        `,
        [safeLimit, safeOffset],
      ),
      this.dataSource.query('SELECT COUNT(*)::int AS total FROM campaigns'),
    ]);
    AppLogger.dbQuery('select', 'campaigns', startedAt);

    return {
      campaigns: rows.map((row: Record<string, unknown>) => this.mapCampaignRow(row)),
      total: Number(totalRows[0]?.total || 0),
    };
  }

  async getById(id: number): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const rows = await this.dataSource.query(
      `
        SELECT
          c.id,
          c.name,
          c.status,
          c.flow_id AS "flowId",
          c.trunk_id AS "trunkId",
          c.caller_id AS "callerId",
          c.default_country AS "defaultCountry",
          c.scheduled_at AS "scheduledAt",
          c.max_concurrent AS "maxConcurrent",
          c.max_retries AS "maxRetries",
          c.retry_interval_minutes AS "retryIntervalMinutes",
          c.total_contacts AS "totalContacts",
          c.dialed_count AS "dialedCount",
          c.answered_count AS "answeredCount",
          c.failed_count AS "failedCount",
          c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",
          f.name AS "flowName",
          t.name AS "trunkName",
          t.from_user AS "trunkCallerId"
        FROM campaigns c
        LEFT JOIN call_flows f ON f.id = c.flow_id
        LEFT JOIN sip_trunks t ON t.id = c.trunk_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [id],
    );
    AppLogger.dbQuery('select', 'campaigns', startedAt);

    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      throw new NotFoundException(`Campaign ${id} not found`);
    }

    return this.mapCampaignRow(row);
  }

  async create(payload: CampaignPayload): Promise<Record<string, unknown>> {
    const normalized = this.normalizePayload(payload, false);
    const rows = await this.dataSource.query(
      `
        INSERT INTO campaigns (
          name,
          status,
          flow_id,
          trunk_id,
          caller_id,
          default_country,
          scheduled_at,
          max_concurrent,
          max_retries,
          retry_interval_minutes
        )
        VALUES ($1, 'draft', $2, $3, $4, $5, $6::timestamptz, $7, $8, $9)
        RETURNING id
      `,
      [
        normalized.name,
        normalized.flowId,
        normalized.trunkId,
        normalized.callerId,
        normalized.defaultCountry,
        normalized.scheduledAt,
        normalized.maxConcurrent,
        normalized.maxRetries,
        normalized.retryIntervalMinutes,
      ],
    );

    const campaignId = Number(rows[0].id);
    await this.tryAutoSchedule(campaignId);
    return this.getById(campaignId);
  }

  async update(id: number, payload: CampaignPayload): Promise<Record<string, unknown>> {
    const campaign = await this.getById(id);
    const status = String(campaign.status || '');
    if (!['draft', 'scheduled'].includes(status)) {
      throw new BadRequestException('Campaign can only be edited in draft or scheduled state');
    }

    const normalized = this.normalizePayload(payload, true);
    const updates: string[] = [];
    const values: unknown[] = [];

    const setField = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if ('name' in normalized) setField('name', normalized.name);
    if ('flowId' in normalized) setField('flow_id', normalized.flowId);
    if ('trunkId' in normalized) setField('trunk_id', normalized.trunkId);
    if ('callerId' in normalized) setField('caller_id', normalized.callerId);
    if ('defaultCountry' in normalized) setField('default_country', normalized.defaultCountry);
    if ('scheduledAt' in normalized) setField('scheduled_at', normalized.scheduledAt);
    if ('maxConcurrent' in normalized) setField('max_concurrent', normalized.maxConcurrent);
    if ('maxRetries' in normalized) setField('max_retries', normalized.maxRetries);
    if ('retryIntervalMinutes' in normalized) setField('retry_interval_minutes', normalized.retryIntervalMinutes);

    if (updates.length > 0) {
      values.push(id);
      await this.dataSource.query(
        `
          UPDATE campaigns
          SET ${updates.join(', ')}, updated_at = NOW()
          WHERE id = $${values.length}
        `,
        values,
      );
    }

    await this.tryAutoSchedule(id);
    return this.getById(id);
  }

  async remove(id: number): Promise<void> {
    const campaign = await this.getById(id);
    const status = String(campaign.status || '');
    if (!['draft', 'cancelled', 'completed'].includes(status)) {
      throw new BadRequestException('Campaign can only be deleted in draft, cancelled, or completed state');
    }
    await this.dataSource.query('DELETE FROM campaigns WHERE id = $1', [id]);
  }

  async uploadContacts(campaignId: number, fileBuffer: Buffer): Promise<{ imported: number; skipped: number; total: number; skippedReasons: string[] }> {
    const campaign = await this.getById(campaignId);
    const defaultCountry = String(campaign.defaultCountry || 'US').toUpperCase();
    const parsed = this.parseCsv(fileBuffer.toString('utf8'));
    if (!parsed.headers.includes('phone_number')) {
      throw new BadRequestException('CSV must include phone_number column');
    }

    const existingRows = await this.dataSource.query(
      `
        SELECT phone_number AS "phoneNumber"
        FROM campaign_contacts
        WHERE campaign_id = $1
      `,
      [campaignId],
    );

    const seenNumbers = new Set<string>(
      (existingRows as Array<{ phoneNumber: string | null }>).map((row) => String(row.phoneNumber || '').trim()).filter(Boolean),
    );

    const skippedReasons: string[] = [];
    let imported = 0;
    let skipped = 0;

    const addSkipReason = (reason: string) => {
      skipped += 1;
      if (skippedReasons.length < 10) {
        skippedReasons.push(reason);
      }
    };

    for (const row of parsed.rows) {
      const rawNumber = String(row.values.phone_number || '').trim();
      if (!rawNumber) {
        addSkipReason(`row ${row.rowNumber}: missing phone_number`);
        continue;
      }

      const normalizedNumber = this.normalizePhoneNumber(rawNumber, defaultCountry);
      if (!normalizedNumber) {
        addSkipReason(`row ${row.rowNumber}: cannot parse "${rawNumber}" as valid number for ${defaultCountry}`);
        continue;
      }

      if (seenNumbers.has(normalizedNumber)) {
        addSkipReason(`row ${row.rowNumber}: duplicate number in campaign "${normalizedNumber}"`);
        continue;
      }

      const name = String(row.values.name || '').trim();
      await this.dataSource.query(
        `
          INSERT INTO campaign_contacts (campaign_id, phone_number, name)
          VALUES ($1, $2, NULLIF($3, ''))
        `,
        [campaignId, normalizedNumber, name],
      );
      seenNumbers.add(normalizedNumber);
      imported += 1;
    }

    if (skipped > skippedReasons.length) {
      skippedReasons.push(`... and ${skipped - skippedReasons.length} more`);
    }

    await this.dataSource.query(
      `
        UPDATE campaigns
        SET total_contacts = (
          SELECT COUNT(*)::int FROM campaign_contacts WHERE campaign_id = $1
        ),
        updated_at = NOW()
        WHERE id = $1
      `,
      [campaignId],
    );

    return {
      imported,
      skipped,
      total: imported + skipped,
      skippedReasons,
    };
  }

  async listContacts(campaignId: number, limit = 50, offset = 0, status?: string): Promise<{ contacts: Record<string, unknown>[]; total: number }> {
    await this.getById(campaignId);
    const safeLimit = Math.min(200, Math.max(1, Number(limit || 50)));
    const safeOffset = Math.max(0, Number(offset || 0));

    const params: unknown[] = [campaignId];
    let whereSql = 'WHERE campaign_id = $1';
    if (status?.trim()) {
      params.push(status.trim());
      whereSql += ` AND status = $${params.length}`;
    }

    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM campaign_contacts ${whereSql}`,
      params,
    );

    params.push(safeLimit, safeOffset);
    const rows = await this.dataSource.query(
      `
        SELECT
          id,
          campaign_id AS "campaignId",
          phone_number AS "phoneNumber",
          name,
          status,
          attempts,
          last_attempt_at AS "lastAttemptAt",
          next_retry_at AS "nextRetryAt",
          created_at AS "createdAt"
        FROM campaign_contacts
        ${whereSql}
        ORDER BY id ASC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params,
    );

    return {
      contacts: rows.map((row: Record<string, unknown>) => this.mapContactRow(row)),
      total: Number(countRows[0]?.total || 0),
    };
  }

  async listContactAttempts(campaignId: number, contactId: number): Promise<Record<string, unknown>[]> {
    await this.getById(campaignId);
    const contactRows = await this.dataSource.query(
      'SELECT id FROM campaign_contacts WHERE id = $1 AND campaign_id = $2 LIMIT 1',
      [contactId, campaignId],
    );
    if (!contactRows[0]) {
      throw new NotFoundException(`Contact ${contactId} not found in campaign ${campaignId}`);
    }

    const rows = await this.dataSource.query(
      `
        SELECT
          cca.id,
          cca.campaign_id AS "campaignId",
          cca.contact_id AS "contactId",
          cca.phone_number AS "phoneNumber",
          cca.attempt_number AS "attemptNumber",
          cca.outcome,
          cca.call_log_id AS "callLogId",
          cca.started_at AS "startedAt",
          cca.ended_at AS "endedAt",
          cl.duration_seconds AS "durationSeconds",
          cl.end_reason AS "endReason"
        FROM campaign_contact_attempts cca
        LEFT JOIN call_logs cl ON cl.id = cca.call_log_id
        WHERE cca.campaign_id = $1 AND cca.contact_id = $2
        ORDER BY cca.attempt_number DESC, cca.id DESC
      `,
      [campaignId, contactId],
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      campaignId: Number(row.campaignId),
      contactId: Number(row.contactId),
      phoneNumber: String(row.phoneNumber || ''),
      attemptNumber: Number(row.attemptNumber || 0),
      outcome: String(row.outcome || ''),
      callLogId: row.callLogId === null ? null : Number(row.callLogId),
      startedAt: row.startedAt ? new Date(String(row.startedAt)).toISOString() : null,
      endedAt: row.endedAt ? new Date(String(row.endedAt)).toISOString() : null,
      duration: row.durationSeconds === null ? null : Number(row.durationSeconds),
      endReason: row.endReason ? String(row.endReason) : null,
    }));
  }

  async schedule(id: number): Promise<Record<string, unknown>> {
    const campaign = await this.getById(id);
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Only draft campaigns can be scheduled');
    }

    const scheduleError = this.validateSchedulingRequirements(campaign, true);
    if (scheduleError) {
      throw new BadRequestException(scheduleError);
    }

    const startedAt = Date.now();
    await this.dataSource.query(
      `UPDATE campaigns SET status = 'scheduled', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    AppLogger.dbQuery('update', 'campaigns', startedAt);
    AppLogger.event('CampaignStateChange', {
      campaignId: id,
      from: 'draft',
      to: 'scheduled',
    });

    return this.getById(id);
  }

  async stop(id: number): Promise<Record<string, unknown>> {
    const campaign = await this.getById(id);
    if (!['running', 'scheduled', 'cancelling'].includes(String(campaign.status || ''))) {
      throw new BadRequestException('Only running or scheduled campaigns can be stopped');
    }

    await this.publish(`campaign:stop:${id}`, { campaignId: id, ts: Date.now() });
    const startedAt = Date.now();
    await this.dataSource.query(
      `UPDATE campaigns SET status = 'cancelling', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    AppLogger.dbQuery('update', 'campaigns', startedAt);
    AppLogger.event('CampaignStateChange', {
      campaignId: id,
      from: String(campaign.status || ''),
      to: 'cancelling',
    });

    setTimeout(async () => {
      try {
        const result = await this.dataSource.query(
          `SELECT status FROM campaigns WHERE id = $1`,
          [id],
        );
        if (result[0]?.status === 'cancelling') {
          const fallbackStartedAt = Date.now();
          await this.dataSource.query(
            `UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
            [id],
          );
          AppLogger.dbQuery('update', 'campaigns', fallbackStartedAt);
          AppLogger.event('CampaignStateChange', {
            campaignId: id,
            from: 'cancelling',
            to: 'cancelled',
          });
        }
      } catch (error) {
        this.logger.error(`Campaign ${id} cancelling fallback failed`, error instanceof Error ? error.stack : String(error));
      }
    }, 30_000);

    return this.getById(id);
  }

  async getProgress(id: number): Promise<Record<string, unknown>> {
    const campaign = await this.getById(id);

    const pendingRows = await this.dataSource.query(
      `
        SELECT COUNT(*)::int AS total
        FROM campaign_contacts
        WHERE campaign_id = $1 AND status = 'pending'
      `,
      [id],
    );

    const activeRaw = (await this.publisher?.get(`campaign:active:${id}`)) || '0';

    return {
      status: campaign.status,
      totalContacts: Number(campaign.totalContacts || 0),
      dialedCount: Number(campaign.dialedCount || 0),
      answeredCount: Number(campaign.answeredCount || 0),
      failedCount: Number(campaign.failedCount || 0),
      pendingCount: Number(pendingRows[0]?.total || 0),
      activeCallCount: Number(activeRaw || 0),
    };
  }

  async startDueCampaigns(): Promise<number[]> {
    const fetchStartedAt = Date.now();
    const dueRows = await this.dataSource.query(
      `
        SELECT id
        FROM campaigns
        WHERE status = 'scheduled'
          AND scheduled_at IS NOT NULL
          AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
      `,
    );
    AppLogger.dbQuery('select', 'campaigns', fetchStartedAt);

    const started: number[] = [];

    for (const row of dueRows as Array<{ id: number }>) {
      const campaignId = Number(row.id);
      const updateStartedAt = Date.now();
      await this.dataSource.query(
        `
          UPDATE campaigns
          SET status = 'running', updated_at = NOW()
          WHERE id = $1 AND status = 'scheduled'
        `,
        [campaignId],
      );
      AppLogger.dbQuery('update', 'campaigns', updateStartedAt);
      AppLogger.event('CampaignStateChange', {
        campaignId,
        from: 'scheduled',
        to: 'running',
      });
      await this.publish(`campaign:start:${campaignId}`, { campaignId, ts: Date.now() });
      started.push(campaignId);
    }

    return started;
  }

  private async initRedis(): Promise<void> {
    const redisPortRaw = process.env.REDIS_PORT;
    if (!redisPortRaw) {
      this.logger.warn('REDIS_PORT not set — Campaigns Redis pub/sub disabled');
      return;
    }

    const redisPort = Number(redisPortRaw);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      this.logger.warn('Invalid REDIS_PORT — Campaigns Redis pub/sub disabled');
      return;
    }

    const clientConfig = {
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    };

    this.publisher = createClient(clientConfig);
    this.subscriber = this.publisher.duplicate();

    this.publisher.on('error', (error) => this.logger.error(`Campaigns Redis publisher error: ${String(error)}`));
    this.subscriber.on('error', (error) => this.logger.error(`Campaigns Redis subscriber error: ${String(error)}`));

    await this.publisher.connect().catch((error) => {
      this.logger.warn(`Campaigns Redis publisher connect failed: ${String(error)}`);
    });

    await this.subscriber.connect().catch((error) => {
      this.logger.warn(`Campaigns Redis subscriber connect failed: ${String(error)}`);
    });

    if (!this.subscriber.isReady) {
      return;
    }

    await this.subscriber.subscribe('campaign:contact:update', async (message) => {
      try {
        const payload = JSON.parse(message) as CampaignContactUpdateEvent;
        AppLogger.redisConsume('campaign:contact:update', this.compactPayload(payload));
        await this.handleCampaignContactUpdate(payload);
      } catch (error) {
        this.logger.error('Failed handling campaign:contact:update', error instanceof Error ? error.stack : String(error));
      }
    });

    await this.subscriber.subscribe('campaign:stats:update', async (message) => {
      try {
        const payload = JSON.parse(message) as CampaignStatsUpdateEvent;
        AppLogger.redisConsume('campaign:stats:update', this.compactPayload(payload));
        const startedAt = Date.now();
        await this.dataSource.query(
          `
            UPDATE campaigns
            SET dialed_count = $2,
                answered_count = $3,
                failed_count = $4,
                updated_at = NOW()
            WHERE id = $1
          `,
          [payload.campaignId, payload.dialedCount, payload.answeredCount, payload.failedCount],
        );
        AppLogger.dbQuery('update', 'campaigns', startedAt);
      } catch (error) {
        this.logger.error('Failed handling campaign:stats:update', error instanceof Error ? error.stack : String(error));
      }
    });

    await this.subscriber.subscribe('campaign:completed', async (message) => {
      try {
        const payload = JSON.parse(message) as { campaignId: number };
        AppLogger.redisConsume('campaign:completed', this.compactPayload(payload));
        const startedAt = Date.now();
        await this.dataSource.query(`UPDATE campaigns SET status = 'completed', updated_at = NOW() WHERE id = $1`, [payload.campaignId]);
        AppLogger.dbQuery('update', 'campaigns', startedAt);
        AppLogger.event('CampaignStateChange', {
          campaignId: payload.campaignId,
          from: 'running',
          to: 'completed',
        });
      } catch (error) {
        this.logger.error('Failed handling campaign:completed', error instanceof Error ? error.stack : String(error));
      }
    });

    await this.subscriber.subscribe('campaign:cancelled', async (message) => {
      try {
        const payload = JSON.parse(message) as { campaignId: number };
        AppLogger.redisConsume('campaign:cancelled', this.compactPayload(payload));
        const startedAt = Date.now();
        await this.dataSource.query(`UPDATE campaigns SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [payload.campaignId]);
        AppLogger.dbQuery('update', 'campaigns', startedAt);
        AppLogger.event('CampaignStateChange', {
          campaignId: payload.campaignId,
          from: 'cancelling',
          to: 'cancelled',
        });
      } catch (error) {
        this.logger.error('Failed handling campaign:cancelled', error instanceof Error ? error.stack : String(error));
      }
    });
  }

  private async handleCampaignContactUpdate(payload: CampaignContactUpdateEvent): Promise<void> {
    const status = String(payload.status || '').trim();
    if (!payload.campaignId || !payload.contactId || !status) {
      return;
    }

    if (status === 'dialing') {
      const startedAt = Date.now();
      await this.dataSource.query(
        `
          UPDATE campaign_contacts
          SET status = 'dialing',
              attempts = attempts + 1,
              last_attempt_at = NOW(),
              next_retry_at = NULL
          WHERE id = $1 AND campaign_id = $2
        `,
        [payload.contactId, payload.campaignId],
      );
      AppLogger.dbQuery('update', 'campaign_contacts', startedAt);
      const contactRows = await this.dataSource.query(
        `
          SELECT phone_number AS "phoneNumber"
          FROM campaign_contacts
          WHERE id = $1 AND campaign_id = $2
          LIMIT 1
        `,
        [payload.contactId, payload.campaignId],
      );
      AppLogger.event('CampaignDial', {
        campaignId: payload.campaignId,
        contactId: payload.contactId,
        destination: String(contactRows[0]?.phoneNumber || ''),
      });
      return;
    }

    if (status === 'pending') {
      const minutes = Number(payload.retryAfterMinutes || 30);
      await this.dataSource.query(
        `
          UPDATE campaign_contacts
          SET status = 'pending',
              next_retry_at = NOW() + ($3::int * INTERVAL '1 minute')
          WHERE id = $1 AND campaign_id = $2
        `,
        [payload.contactId, payload.campaignId, minutes],
      );
      return;
    }

    await this.dataSource.query(
      `
        UPDATE campaign_contacts
        SET status = $3,
            next_retry_at = NULL
        WHERE id = $1 AND campaign_id = $2
      `,
      [payload.contactId, payload.campaignId, status],
    );

    const contactRows = await this.dataSource.query(
      `
        SELECT phone_number AS "phoneNumber", attempts
        FROM campaign_contacts
        WHERE id = $1 AND campaign_id = $2
        LIMIT 1
      `,
      [payload.contactId, payload.campaignId],
    );

    const phoneNumber = String(contactRows[0]?.phoneNumber || '');
    const attempts = Number(contactRows[0]?.attempts || payload.attemptNumber || 1);

    let callLogId = payload.callLogId ?? null;
    if (!callLogId && payload.callId) {
      const logRows = await this.dataSource.query(
        `SELECT id FROM call_logs WHERE call_uuid = $1 ORDER BY id DESC LIMIT 1`,
        [payload.callId],
      );
      callLogId = logRows[0]?.id ? Number(logRows[0].id) : null;
    }

    if (payload.outcome) {
      await this.dataSource.query(
        `
          INSERT INTO campaign_contact_attempts (
            campaign_id,
            contact_id,
            phone_number,
            attempt_number,
            outcome,
            call_log_id,
            started_at,
            ended_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            COALESCE($7::timestamptz, NOW()),
            COALESCE($8::timestamptz, NOW())
          )
        `,
        [
          payload.campaignId,
          payload.contactId,
          phoneNumber,
          attempts,
          payload.outcome,
          callLogId,
          payload.startedAt || null,
          payload.endedAt || null,
        ],
      );
    }
  }

  private async publish(channel: string, payload: unknown): Promise<void> {
    if (!this.publisher?.isReady) {
      return;
    }
    await this.publisher.publish(channel, JSON.stringify(payload));
    AppLogger.redisPublish(channel, this.compactPayload(payload));
  }

  private compactPayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object') {
      return {};
    }
    const source = payload as Record<string, unknown>;
    return {
      campaignId: source.campaignId,
      contactId: source.contactId,
      status: source.status,
      outcome: source.outcome,
      callId: source.callId,
    };
  }

  private normalizePayload(payload: CampaignPayload, partial: boolean): CampaignPayload {
    const out: CampaignPayload = {};

    if (!partial || payload.name !== undefined) {
      const name = String(payload.name || '').trim();
      if (!name) throw new BadRequestException('name is required');
      out.name = name;
    }

    if (payload.flowId !== undefined) {
      out.flowId = payload.flowId === null ? null : Number(payload.flowId);
    }
    if (payload.trunkId !== undefined) {
      out.trunkId = payload.trunkId === null ? null : Number(payload.trunkId);
    }
    if (payload.callerId !== undefined) {
      const callerId = payload.callerId === null ? null : String(payload.callerId).trim();
      out.callerId = callerId ? callerId : null;
    }
    if (!partial || payload.defaultCountry !== undefined) {
      const value = String(payload.defaultCountry ?? 'US').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(value)) {
        throw new BadRequestException('defaultCountry must be a 2-letter ISO country code');
      }
      out.defaultCountry = value;
    }
    if (payload.scheduledAt !== undefined) {
      out.scheduledAt = payload.scheduledAt;
    }

    if (!partial || payload.maxConcurrent !== undefined) {
      const value = Number(payload.maxConcurrent ?? 3);
      if (!Number.isFinite(value) || value < 1 || value > 10) {
        throw new BadRequestException('maxConcurrent must be between 1 and 10');
      }
      out.maxConcurrent = Math.floor(value);
    }

    if (!partial || payload.maxRetries !== undefined) {
      const value = Number(payload.maxRetries ?? 2);
      if (!Number.isFinite(value) || value < 0 || value > 5) {
        throw new BadRequestException('maxRetries must be between 0 and 5');
      }
      out.maxRetries = Math.floor(value);
    }

    if (!partial || payload.retryIntervalMinutes !== undefined) {
      const value = Number(payload.retryIntervalMinutes ?? 30);
      if (!Number.isFinite(value) || value < 5) {
        throw new BadRequestException('retryIntervalMinutes must be >= 5');
      }
      out.retryIntervalMinutes = Math.floor(value);
    }

    return out;
  }

  private mapCampaignRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: Number(row.id),
      name: String(row.name || ''),
      status: String(row.status || ''),
      flowId: row.flowId === null ? null : Number(row.flowId),
      trunkId: row.trunkId === null ? null : Number(row.trunkId),
      callerId: row.callerId ? String(row.callerId) : null,
      defaultCountry: String(row.defaultCountry || 'US').toUpperCase(),
      flowName: row.flowName ? String(row.flowName) : null,
      trunkName: row.trunkName ? String(row.trunkName) : null,
      trunkCallerId: row.trunkCallerId ? String(row.trunkCallerId) : null,
      scheduledAt: row.scheduledAt ? new Date(String(row.scheduledAt)).toISOString() : null,
      maxConcurrent: Number(row.maxConcurrent || 0),
      maxRetries: Number(row.maxRetries || 0),
      retryIntervalMinutes: Number(row.retryIntervalMinutes || 0),
      totalContacts: Number(row.totalContacts || 0),
      dialedCount: Number(row.dialedCount || 0),
      answeredCount: Number(row.answeredCount || 0),
      failedCount: Number(row.failedCount || 0),
      createdAt: row.createdAt ? new Date(String(row.createdAt)).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(String(row.updatedAt)).toISOString() : null,
    };
  }

  private mapContactRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: Number(row.id),
      campaignId: Number(row.campaignId),
      phoneNumber: String(row.phoneNumber || ''),
      name: row.name ? String(row.name) : null,
      status: String(row.status || ''),
      attempts: Number(row.attempts || 0),
      lastAttemptAt: row.lastAttemptAt ? new Date(String(row.lastAttemptAt)).toISOString() : null,
      nextRetryAt: row.nextRetryAt ? new Date(String(row.nextRetryAt)).toISOString() : null,
      createdAt: row.createdAt ? new Date(String(row.createdAt)).toISOString() : null,
    };
  }

  private parseCsv(input: string): { headers: string[]; rows: Array<{ rowNumber: number; values: Record<string, string> }> } {
    const lines = input
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = this.parseCsvLine(lines[0]).map((value) => value.trim());
    const rows = lines.slice(1).map((line, index) => {
      const values = this.parseCsvLine(line);
      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length; i += 1) {
        row[headers[i]] = values[i] || '';
      }
      return {
        rowNumber: index + 2,
        values: row,
      };
    });

    return { headers, rows };
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let value = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(value.trim());
        value = '';
        continue;
      }

      value += char;
    }

    values.push(value.trim());
    return values;
  }

  private normalizePhoneNumber(raw: string, defaultCountry: string): string | null {
    const value = String(raw || '').trim();
    if (!value) return null;

    const country = String(defaultCountry || 'US').trim().toUpperCase() as CountryCode;
    const valid = value.startsWith('+') ? isValidPhoneNumber(value) : isValidPhoneNumber(value, country);
    if (!valid) {
      return null;
    }

    const parsed = value.startsWith('+') ? parsePhoneNumber(value) : parsePhoneNumber(value, country);
    if (!parsed || !parsed.isValid()) {
      return null;
    }

    return parsed.format('E.164');
  }

  private async tryAutoSchedule(campaignId: number): Promise<void> {
    const campaign = await this.getById(campaignId);
    if (String(campaign.status || '') !== 'draft') {
      return;
    }

    const scheduleError = this.validateSchedulingRequirements(campaign, true);
    if (scheduleError) {
      return;
    }

    await this.dataSource.query(
      `UPDATE campaigns SET status = 'scheduled', updated_at = NOW() WHERE id = $1 AND status = 'draft'`,
      [campaignId],
    );
  }

  private validateSchedulingRequirements(campaign: Record<string, unknown>, requireFuture: boolean): string | null {
    if (!campaign.flowId) return 'flow_id is required before scheduling';
    if (!campaign.trunkId) return 'trunk_id is required before scheduling';
    if (!campaign.scheduledAt) return 'scheduled_at is required before scheduling';

    const scheduledAtMs = new Date(String(campaign.scheduledAt)).getTime();
    if (!Number.isFinite(scheduledAtMs)) return 'scheduled_at is required before scheduling';
    if (requireFuture && scheduledAtMs <= Date.now()) {
      return 'scheduled time must be in the future';
    }

    if (Number(campaign.totalContacts || 0) <= 0) return 'contacts are required before scheduling';
    return null;
  }
}
