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

interface CallbackCreatedPayload {
  flowId: number | null;
  trunkId: number | null;
  customerNumber: string | null;
  operatorId: number | null;
  destinationType?: string | null;
  destinationValue?: string | null;
  destinationTrunkId?: number | null;
  callLogId: number | null;
  failReason?: string;
}

interface CallbackStatusUpdatePayload {
  callbackId: number;
  status: string;
  failReason?: string;
}

interface ExecuteCallbackPayload {
  callbackId: number;
  customerNumber?: string;
  customerTrunkId?: number | null;
  customerDialString: string;
  operatorDialString: string;
  callerIdNumber: string;
}

@Injectable()
export class CallbacksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(CallbacksService.name);
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

  async listCallbacks(query: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<{ data: Record<string, unknown>[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, Number(query.page || 1));
    const safeLimit = Math.max(1, Number(query.limit || 20));
    const offset = (safePage - 1) * safeLimit;
    const status = String(query.status || '').trim();

    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (status) {
      if (status === 'dialing') {
        whereParts.push(`c.status IN ('dialing_operator', 'dialing_customer', 'bridged')`);
      } else {
        params.push(status);
        whereParts.push(`c.status = $${params.length}`);
      }
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const [rows, totalRows] = await Promise.all([
      this.dataSource.query(
        `
          SELECT
            c.id,
            c.flow_id AS "flowId",
            c.trunk_id AS "trunkId",
            c.customer_number AS "customerNumber",
            c.operator_id AS "operatorId",
            c.destination_type AS "destinationType",
            c.destination_value AS "destinationValue",
            c.destination_trunk_id AS "destinationTrunkId",
            c.status,
            c.fail_reason AS "failReason",
            c.call_log_id AS "callLogId",
            c.created_at AS "createdAt",
            c.executed_at AS "executedAt",
            c.completed_at AS "completedAt",
            COALESCE(
              o.name,
              (
                SELECT
                  CASE
                    WHEN COALESCE(se.display_name, '') <> '' THEN (se.username || ' ' || se.display_name)
                    ELSE se.username
                  END
                FROM sip_extensions se
                WHERE c.destination_type = 'extension'
                  AND (se.username = c.destination_value OR se.id::text = c.destination_value)
                ORDER BY
                  CASE WHEN se.username = c.destination_value THEN 0 ELSE 1 END,
                  se.id ASC
                LIMIT 1
              )
            ) AS "operatorName"
          FROM callbacks c
          LEFT JOIN operators o ON o.id = c.operator_id
          ${whereSql}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, safeLimit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total FROM callbacks c ${whereSql}`,
        params,
      ),
    ]);

    return {
      data: rows.map((row: Record<string, unknown>) => this.mapRow(row)),
      total: Number(totalRows[0]?.total || 0),
      page: safePage,
      limit: safeLimit,
    };
  }

  async getCallback(id: number): Promise<{ data: Record<string, unknown> }> {
    const rows = await this.dataSource.query(
      `
        SELECT
          c.id,
          c.flow_id AS "flowId",
          c.trunk_id AS "trunkId",
          c.customer_number AS "customerNumber",
          c.operator_id AS "operatorId",
          c.destination_type AS "destinationType",
          c.destination_value AS "destinationValue",
          c.destination_trunk_id AS "destinationTrunkId",
          c.status,
          c.fail_reason AS "failReason",
          c.call_log_id AS "callLogId",
          c.created_at AS "createdAt",
          c.executed_at AS "executedAt",
          c.completed_at AS "completedAt",
          COALESCE(
            o.name,
            (
              SELECT
                CASE
                  WHEN COALESCE(se.display_name, '') <> '' THEN (se.username || ' ' || se.display_name)
                  ELSE se.username
                END
              FROM sip_extensions se
              WHERE c.destination_type = 'extension'
                AND (se.username = c.destination_value OR se.id::text = c.destination_value)
              ORDER BY
                CASE WHEN se.username = c.destination_value THEN 0 ELSE 1 END,
                se.id ASC
              LIMIT 1
            )
          ) AS "operatorName"
        FROM callbacks c
        LEFT JOIN operators o ON o.id = c.operator_id
        WHERE c.id = $1
        LIMIT 1
      `,
      [id],
    );

    if (!rows[0]) {
      throw new NotFoundException(`Callback ${id} not found`);
    }

    return { data: this.mapRow(rows[0] as Record<string, unknown>) };
  }

  async executeCallback(callbackId: number): Promise<{ success: true }> {
    const callbackRows = await this.dataSource.query(
      `
        SELECT
          id,
          customer_number AS "customerNumber",
          operator_id AS "operatorId",
          trunk_id AS "customerTrunkId",
          destination_type AS "destinationType",
          destination_value AS "destinationValue",
          destination_trunk_id AS "destinationTrunkId",
          status
        FROM callbacks
        WHERE id = $1
        LIMIT 1
      `,
      [callbackId],
    );
    const callback = callbackRows[0] as {
      id: number;
      customerNumber: string;
      operatorId: number | null;
      customerTrunkId: number | null;
      destinationType: string | null;
      destinationValue: string | null;
      destinationTrunkId: number | null;
      status: string;
    } | undefined;

    if (!callback) {
      throw new NotFoundException(`Callback ${callbackId} not found`);
    }

    if (callback.status !== 'pending') {
      throw new BadRequestException('Callback is not pending');
    }

    if (!callback.customerNumber) {
      throw new BadRequestException('Callback has no customer number');
    }

    let operatorDialString = '';
    const destinationType = String(callback.destinationType || '').trim();
    const destinationValue = String(callback.destinationValue || '').trim();
    if (!destinationType || !destinationValue) {
      throw new BadRequestException('no_destination_configured');
    }
    if (destinationType === 'extension') {
      operatorDialString = `PJSIP/${destinationValue}`;
    } else if (destinationType === 'pstn') {
      if (!callback.destinationTrunkId) {
        throw new BadRequestException('no_destination_configured');
      }
      operatorDialString = `PJSIP/${destinationValue}@trunk-${callback.destinationTrunkId}`;
    } else {
      throw new BadRequestException('no_destination_configured');
    }

    let customerDialString = '';
    let callerIdNumber = '';
    if (callback.customerTrunkId) {
      customerDialString = `PJSIP/${callback.customerNumber}@trunk-${callback.customerTrunkId}`;
      const trunkRows = await this.dataSource.query(
        'SELECT from_user AS "fromUser" FROM sip_trunks WHERE id = $1 LIMIT 1',
        [callback.customerTrunkId],
      );
      callerIdNumber = String(trunkRows[0]?.fromUser || '').trim();
      if (!callerIdNumber) {
        throw new BadRequestException(`Trunk ${callback.customerTrunkId} is missing from_user caller id`);
      }
    } else if (/^\d{2,20}$/.test(String(callback.customerNumber || '').trim())) {
      customerDialString = `PJSIP/${callback.customerNumber}`;
      callerIdNumber = String(callback.customerNumber || '').trim();
    } else {
      throw new BadRequestException('Callback has no routable customer target');
    }

    await this.dataSource.query(
      `
        UPDATE callbacks
        SET status = 'dialing_operator', fail_reason = NULL, executed_at = NOW()
        WHERE id = $1
      `,
      [callbackId],
    );

    await this.publish('callback:execute', {
      callbackId,
      customerNumber: callback.customerNumber,
      customerTrunkId: callback.customerTrunkId,
      customerDialString,
      operatorDialString,
      callerIdNumber,
    } satisfies ExecuteCallbackPayload);

    return { success: true };
  }

  async cancelCallback(callbackId: number): Promise<{ success: true }> {
    const rows = await this.dataSource.query('SELECT id, status FROM callbacks WHERE id = $1 LIMIT 1', [callbackId]);
    const callback = rows[0] as { id: number; status: string } | undefined;
    if (!callback) {
      throw new NotFoundException(`Callback ${callbackId} not found`);
    }

    if (callback.status !== 'pending') {
      throw new BadRequestException('Only pending callbacks can be cancelled');
    }

    await this.dataSource.query(
      `
        UPDATE callbacks
        SET status = 'cancelled', completed_at = NOW()
        WHERE id = $1
      `,
      [callbackId],
    );

    return { success: true };
  }

  async handleCallbackCreated(payload: CallbackCreatedPayload): Promise<void> {
    const normalizedCustomerNumber = this.normalizeCustomerNumber(payload.customerNumber);
    const failReason = String(payload.failReason || '').trim() || null;

    if (failReason || !normalizedCustomerNumber) {
      await this.dataSource.query(
        `
          INSERT INTO callbacks (
            flow_id,
            trunk_id,
            customer_number,
            operator_id,
            destination_type,
            destination_value,
            destination_trunk_id,
            status,
            fail_reason,
            call_log_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'failed', $8, $9)
        `,
        [
          payload.flowId,
          payload.trunkId,
          normalizedCustomerNumber || '',
          payload.operatorId,
          payload.destinationType ? String(payload.destinationType) : null,
          payload.destinationValue ? String(payload.destinationValue) : null,
          payload.destinationTrunkId ? Number(payload.destinationTrunkId) : null,
          failReason || 'invalid_customer_number',
          payload.callLogId,
        ],
      );
      return;
    }

    await this.dataSource.query(
      `
        INSERT INTO callbacks (
          flow_id,
          trunk_id,
          customer_number,
          operator_id,
          destination_type,
          destination_value,
          destination_trunk_id,
          status,
          call_log_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
      `,
      [
        payload.flowId,
        payload.trunkId,
        normalizedCustomerNumber,
        payload.operatorId,
        payload.destinationType ? String(payload.destinationType) : null,
        payload.destinationValue ? String(payload.destinationValue) : null,
        payload.destinationTrunkId ? Number(payload.destinationTrunkId) : null,
        payload.callLogId,
      ],
    );
  }

  private normalizeCustomerNumber(value: string | null): string | null {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }

    // Keep internal extension-like identifiers (for internal callback routing records)
    // even when they are not E.164 numbers.
    if (/^\d{2,20}$/.test(raw)) {
      return raw;
    }

    const defaultCountry = (process.env.CALLBACK_DEFAULT_COUNTRY || 'LK').toUpperCase() as CountryCode;
    const valid = raw.startsWith('+') ? isValidPhoneNumber(raw) : isValidPhoneNumber(raw, defaultCountry);
    if (!valid) {
      return null;
    }

    const parsed = raw.startsWith('+') ? parsePhoneNumber(raw) : parsePhoneNumber(raw, defaultCountry);
    if (!parsed || !parsed.isValid()) {
      return null;
    }

    return parsed.format('E.164');
  }

  private async handleStatusUpdate(payload: CallbackStatusUpdatePayload): Promise<void> {
    if (!payload.callbackId || !payload.status) {
      return;
    }

    if (payload.status === 'completed' || payload.status === 'failed' || payload.status === 'cancelled') {
      await this.dataSource.query(
        `
          UPDATE callbacks
          SET status = $2,
              fail_reason = CASE WHEN $3::text IS NULL THEN fail_reason ELSE $3::text END,
              completed_at = NOW()
          WHERE id = $1
        `,
        [payload.callbackId, payload.status, payload.failReason || null],
      );
      return;
    }

    if (payload.status === 'dialing_operator' || payload.status === 'dialing_customer' || payload.status === 'bridged') {
      await this.dataSource.query(
        `
          UPDATE callbacks
          SET status = $2,
              fail_reason = CASE WHEN $3::text IS NULL THEN fail_reason ELSE $3::text END,
              executed_at = COALESCE(executed_at, NOW())
          WHERE id = $1
        `,
        [payload.callbackId, payload.status, payload.failReason || null],
      );
      return;
    }

    await this.dataSource.query(
      `
        UPDATE callbacks
        SET status = $2,
            fail_reason = CASE WHEN $3::text IS NULL THEN fail_reason ELSE $3::text END
        WHERE id = $1
      `,
      [payload.callbackId, payload.status, payload.failReason || null],
    );
  }

  private mapRow(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: Number(row.id),
      flowId: row.flowId === null ? null : Number(row.flowId),
      trunkId: row.trunkId === null ? null : Number(row.trunkId),
      customerNumber: String(row.customerNumber || ''),
      operatorId: row.operatorId === null ? null : Number(row.operatorId),
      operatorName: row.operatorName ? String(row.operatorName) : null,
      destinationType: row.destinationType ? String(row.destinationType) : null,
      destinationValue: row.destinationValue ? String(row.destinationValue) : null,
      destinationTrunkId: row.destinationTrunkId === null || row.destinationTrunkId === undefined ? null : Number(row.destinationTrunkId),
      status: String(row.status || ''),
      failReason: row.failReason ? String(row.failReason) : null,
      callLogId: row.callLogId === null ? null : Number(row.callLogId),
      createdAt: row.createdAt ? new Date(String(row.createdAt)).toISOString() : null,
      executedAt: row.executedAt ? new Date(String(row.executedAt)).toISOString() : null,
      completedAt: row.completedAt ? new Date(String(row.completedAt)).toISOString() : null,
    };
  }

  private async initRedis(): Promise<void> {
    if (this.publisher && this.subscriber) {
      return;
    }

    const redisPortRaw = process.env.REDIS_PORT;
    if (!redisPortRaw) {
      this.logger.warn('REDIS_PORT not set — callback redis listeners disabled');
      return;
    }

    const redisPort = Number(redisPortRaw);
    if (!Number.isFinite(redisPort) || redisPort <= 0) {
      this.logger.warn('Redis port not configured — callback redis listeners disabled');
      return;
    }

    this.publisher = createClient({
      socket: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: redisPort,
      },
    });
    this.publisher.on('error', (error) => {
      this.logger.warn(`callback redis publisher error: ${error instanceof Error ? error.message : String(error)}`);
    });
    await this.publisher.connect();

    this.subscriber = this.publisher.duplicate();
    this.subscriber.on('error', (error) => {
      this.logger.warn(`callback redis subscriber error: ${error instanceof Error ? error.message : String(error)}`);
    });
    await this.subscriber.connect();

    await this.subscriber.subscribe('callback:created', async (message) => {
      try {
        const payload = JSON.parse(message) as CallbackCreatedPayload;
        AppLogger.redisConsume('callback:created', this.compactPayload(payload));
        await this.handleCallbackCreated(payload);
      } catch (error) {
        this.logger.error('callback:created handling failed', error instanceof Error ? error.stack : String(error));
      }
    });

    await this.subscriber.subscribe('callback:status:update', async (message) => {
      try {
        const payload = JSON.parse(message) as CallbackStatusUpdatePayload;
        AppLogger.redisConsume('callback:status:update', this.compactPayload(payload));
        await this.handleStatusUpdate(payload);
      } catch (error) {
        this.logger.error('callback:status:update handling failed', error instanceof Error ? error.stack : String(error));
      }
    });
  }

  private async publish(channel: string, payload: unknown): Promise<void> {
    if (!this.publisher) {
      await this.initRedis();
    }
    if (!this.publisher) {
      throw new BadRequestException('Redis publisher unavailable');
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
      callbackId: source.callbackId,
      callLogId: source.callLogId,
      flowId: source.flowId,
      trunkId: source.trunkId,
      status: source.status,
      customerNumber: source.customerNumber,
    };
  }
}
