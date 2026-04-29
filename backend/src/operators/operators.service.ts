import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { isValidPhoneNumber, parsePhoneNumber } from 'libphonenumber-js';
import { createClient, RedisClientType } from 'redis';
import { DataSource, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
import { CreateOperatorDto } from './dto/create-operator.dto';
import { UpdateOperatorDto } from './dto/update-operator.dto';
import { OperatorEntity } from './entities/operator.entity';

export type OperatorStatus = 'offline' | 'available' | 'busy';

export interface OperatorExtensionResponse {
  id: number;
  username: string;
  transportType: 'sip' | 'webrtc';
}

export interface OperatorContactNumberResponse {
  id: number;
  label: string;
  number: string;
  trunkId: number | null;
}

export interface OperatorResponse {
  id: number;
  name: string;
  status: OperatorStatus;
  extension: OperatorExtensionResponse | null;
  contactNumber: OperatorContactNumberResponse | null;
  hasPIN: boolean;
  pin: string | null;
  callbackNumber: string | null;
  callbackTrunkId: number | null;
  createdAt: string;
}

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class OperatorsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger(OperatorsService.name);
  private redisClient: RedisClientType | null = null;
  private pinColumnAvailable: boolean | null = null;
  private callbackColumnsAvailable: boolean | null = null;
  private readonly runtimePins = new Map<number, string>();

  constructor(
    @InjectRepository(OperatorEntity)
    private readonly operatorsRepository: Repository<OperatorEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.getRedisClient();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    await this.redisClient.disconnect().catch(() => undefined);
    this.redisClient = null;
  }

  private async getRedisClient(): Promise<RedisClientType> {
    if (!this.redisClient) {
      this.redisClient = createClient({
        socket: {
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: Number(process.env.REDIS_PORT) || 6379,
        },
      }) as RedisClientType;
      this.redisClient.on('error', (error: unknown) => {
        this.logger.error('Redis client error', error instanceof Error ? error.stack : String(error));
      });
      await this.redisClient.connect();
    }
    return this.redisClient;
  }

  private generatePin(): string {
    const pin = Math.floor(100000 + Math.random() * 900000);
    return String(pin);
  }

  private async getOperatorStatus(id: number): Promise<OperatorStatus> {
    try {
      const redis = await this.getRedisClient();
      const queueKey = await redis.get(`operator:${id}:queue`);
      if (!queueKey) {
        return 'offline';
      }
      const queueId = queueKey;
      const isBusy = await redis.sIsMember(`queue:${queueId}:busy`, String(id));
      return isBusy ? 'busy' : 'available';
    } catch (error) {
      this.logger.error(`Failed to get status for operator ${id}`, error instanceof Error ? error.stack : String(error));
      return 'offline';
    }
  }

  async findAll(page = 1, limit = 10): Promise<{ data: OperatorResponse[]; total: number; page: number; limit: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const offset = (safePage - 1) * safeLimit;
    const includePinColumn = await this.hasPinColumn();
    const includeCallbackColumns = await this.hasCallbackColumns();
    const pinColumnSelect = includePinColumn ? ',\n        pin' : '';
    const callbackColumnSelect = includeCallbackColumns
      ? `,
        callback_number,
        callback_trunk_id`
      : '';
    const totalRows = await this.dataSource.query('SELECT COUNT(*)::int AS total FROM operators');
    const total = Number(totalRows[0]?.total ?? 0);
    const rows = await this.dataSource.query(
      `SELECT
        id,
        name,
        pin_hash,
        extension_id,
        contact_number_id${pinColumnSelect}${callbackColumnSelect},
        created_at,
        updated_at
      FROM operators
      ORDER BY name ASC
      LIMIT $1 OFFSET $2`,
      [safeLimit, offset],
    );
    const items = rows.map((row: Record<string, unknown>) => this.operatorsRepository.create({
      id: Number(row.id),
      name: String(row.name),
      pinHash: String(row.pin_hash),
      extensionId: row.extension_id === null ? null : Number(row.extension_id),
      contactNumberId: row.contact_number_id === null ? null : Number(row.contact_number_id),
      callbackNumber: includeCallbackColumns && row.callback_number ? String(row.callback_number) : null,
      callbackTrunkId: includeCallbackColumns && row.callback_trunk_id !== null ? Number(row.callback_trunk_id) : null,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    }));
    // TODO(perf): N+1 query here. toResponse() performs per-operator status + join lookups.
    // Consider batch loading status/link data for paginated lists.
    const responses = await Promise.all(items.map(async (item, index) => {
      const row = rows[index] as Record<string, unknown> | undefined;
      const pin = includePinColumn && row ? (row.pin ? String(row.pin) : null) : null;
      return this.toResponse(item, pin);
    }));
    return { data: responses, total, page: safePage, limit: safeLimit };
  }

  async create(dto: CreateOperatorDto): Promise<{ data: OperatorResponse }> {
    const name = this.normalizeRequired(dto.name, 'name');
    const extensionId = dto.extension_id ?? null;
    const contactNumberId = dto.contact_number_id ?? null;

    await this.ensureOperatorLinks(extensionId, contactNumberId);

    const pin = dto.pin?.trim() || this.generatePin();
    const pinHash = await bcrypt.hash(pin, BCRYPT_SALT_ROUNDS);

    const callbackNumber = this.normalizeCallbackNumber(dto.callback_number);
    const callbackTrunkId = dto.callback_trunk_id ?? null;
    if (callbackNumber && !callbackTrunkId) {
      throw new BadRequestException('callback_trunk_id is required when callback_number is set');
    }

    const entity = this.operatorsRepository.create({
      name,
      pinHash,
      extensionId,
      contactNumberId,
      callbackNumber,
      callbackTrunkId,
    });

    const saved = await this.operatorsRepository.save(entity);
    await this.storePlainPinIfSupported(saved.id, pin);
    this.runtimePins.set(saved.id, pin);
    return { data: await this.toResponse(saved, pin) };
  }

  async update(id: number, dto: UpdateOperatorDto): Promise<{ data: OperatorResponse }> {
    const entity = await this.operatorsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Operator ${id} not found`);
    }

    if (dto.name !== undefined) {
      entity.name = this.normalizeRequired(dto.name, 'name');
    }
    if (dto.extension_id !== undefined) {
      entity.extensionId = dto.extension_id ?? null;
    }
    if (dto.contact_number_id !== undefined) {
      entity.contactNumberId = dto.contact_number_id ?? null;
    }
    if (dto.callback_number !== undefined) {
      entity.callbackNumber = this.normalizeCallbackNumber(dto.callback_number);
    }
    if (dto.callback_trunk_id !== undefined) {
      entity.callbackTrunkId = dto.callback_trunk_id ?? null;
    }

    if (entity.callbackNumber && !entity.callbackTrunkId) {
      throw new BadRequestException('callback_trunk_id is required when callback_number is set');
    }

    await this.ensureOperatorLinks(entity.extensionId, entity.contactNumberId);

    if (dto.pin !== undefined) {
      entity.pinHash = await bcrypt.hash(dto.pin.trim(), BCRYPT_SALT_ROUNDS);
    }

    const saved = await this.operatorsRepository.save(entity);
    if (dto.pin !== undefined) {
      await this.storePlainPinIfSupported(saved.id, dto.pin.trim());
      this.runtimePins.set(saved.id, dto.pin.trim());
    }
    return { data: await this.toResponse(saved) };
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const entity = await this.operatorsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Operator ${id} not found`);
    }

    await this.operatorsRepository.delete({ id });
    await this.cleanupRedis(id);
    this.runtimePins.delete(id);

    return { data: { id, deleted: true } };
  }

  private async cleanupRedis(id: number): Promise<void> {
    try {
      const redis = await this.getRedisClient();
      const queueId = await redis.get(`operator:${id}:queue`);
      if (queueId) {
        await redis.sRem(`queue:${queueId}:operators`, String(id));
        await redis.sRem(`queue:${queueId}:busy`, String(id));
      }
      await redis.del(`operator:${id}:queue`);
      await redis.del(`operator:${id}:channel`);
    } catch (error) {
      this.logger.error(`Redis cleanup failed for operator ${id}`, error instanceof Error ? error.stack : String(error));
    }
  }

  private async ensureOperatorLinks(
    extensionId: number | null,
    contactNumberId: number | null,
  ): Promise<void> {
    const extension = extensionId ? await this.dataSource.query(
      'SELECT id, username FROM sip_extensions WHERE id = $1',
      [extensionId],
    ) : [];

    if (extensionId && !extension.length) {
      throw new BadRequestException(`extension_id ${extensionId} not found`);
    }

    const contact = contactNumberId ? await this.dataSource.query(
      'SELECT id, number FROM contact_numbers WHERE id = $1',
      [contactNumberId],
    ) : [];

    if (contactNumberId && !contact.length) {
      throw new BadRequestException(`contact_number_id ${contactNumberId} not found`);
    }
  }

  private async hasPinColumn(): Promise<boolean> {
    if (this.pinColumnAvailable !== null) {
      return this.pinColumnAvailable;
    }
    const rows = await this.dataSource.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'operators'
         AND column_name = 'pin'
       LIMIT 1`,
    );
    this.pinColumnAvailable = rows.length > 0;
    return this.pinColumnAvailable;
  }

  private async hasCallbackColumns(): Promise<boolean> {
    if (this.callbackColumnsAvailable !== null) {
      return this.callbackColumnsAvailable;
    }
    const rows = await this.dataSource.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'operators'
         AND column_name IN ('callback_number', 'callback_trunk_id')`,
    );
    const names = new Set(
      rows
        .map((row: Record<string, unknown>) => String(row.column_name || ''))
        .filter(Boolean),
    );
    this.callbackColumnsAvailable =
      names.has('callback_number') && names.has('callback_trunk_id');
    return this.callbackColumnsAvailable;
  }

  private async storePlainPinIfSupported(operatorId: number, pin: string): Promise<void> {
    const available = await this.hasPinColumn();
    if (!available) return;
    await this.dataSource.query('UPDATE operators SET pin = $1 WHERE id = $2', [pin, operatorId]);
  }

  private async toResponse(item: OperatorEntity, pin: string | null = null): Promise<OperatorResponse> {
    const status = await this.getOperatorStatus(item.id);
    let includePin = await this.hasPinColumn();
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await this.dataSource.query(
        `SELECT
          e.id AS extension_id,
          e.username AS extension_username,
          e.transport_type AS extension_transport_type,
          c.id AS contact_id,
          c.label AS contact_label,
          c.number AS contact_number,
          c.trunk_id AS contact_trunk_id${includePin ? ', o.pin AS operator_pin' : ''}
        FROM operators o
        LEFT JOIN sip_extensions e ON e.id = o.extension_id
        LEFT JOIN contact_numbers c ON c.id = o.contact_number_id
        WHERE o.id = $1
        LIMIT 1`,
        [item.id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!includePin || !message.includes('column o.pin does not exist')) {
        throw error;
      }
      this.pinColumnAvailable = false;
      includePin = false;
      rows = await this.dataSource.query(
        `SELECT
          e.id AS extension_id,
          e.username AS extension_username,
          e.transport_type AS extension_transport_type,
          c.id AS contact_id,
          c.label AS contact_label,
          c.number AS contact_number,
          c.trunk_id AS contact_trunk_id
        FROM operators o
        LEFT JOIN sip_extensions e ON e.id = o.extension_id
        LEFT JOIN contact_numbers c ON c.id = o.contact_number_id
        WHERE o.id = $1
        LIMIT 1`,
        [item.id],
      );
    }

    const row = rows[0] || {};

    const persistedPin = includePin ? (row.operator_pin ? String(row.operator_pin) : null) : null;
    if (persistedPin) {
      this.runtimePins.set(item.id, persistedPin);
    }
    return {
      id: item.id,
      name: item.name,
      status,
      extension: row.extension_id
        ? {
            id: Number(row.extension_id),
            username: String(row.extension_username),
            transportType: row.extension_transport_type === 'webrtc' ? 'webrtc' : 'sip',
          }
        : null,
      contactNumber: row.contact_id
        ? {
            id: Number(row.contact_id),
            label: String(row.contact_label),
            number: String(row.contact_number),
            trunkId: row.contact_trunk_id === null ? null : Number(row.contact_trunk_id),
          }
        : null,
      hasPIN: Boolean(item.pinHash),
      pin: pin ?? persistedPin ?? this.runtimePins.get(item.id) ?? null,
      callbackNumber: item.callbackNumber || null,
      callbackTrunkId: item.callbackTrunkId ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private normalizeCallbackNumber(value: string | undefined): string | null {
    const raw = String(value || '').trim();
    if (!raw) {
      return null;
    }
    if (!isValidPhoneNumber(raw)) {
      throw new BadRequestException('callback_number must be a valid E.164 number');
    }
    const parsed = parsePhoneNumber(raw);
    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException('callback_number must be a valid E.164 number');
    }
    return parsed.format('E.164');
  }

  private normalizeRequired(value: string | undefined, field: string): string {
    const normalized = (value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }
}
