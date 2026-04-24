import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as net from 'net';
import { createClient, type RedisClientType } from 'redis';
import { DataSource, Repository } from 'typeorm';
import { AsteriskConfigService, type AmiQualifyResult } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { CreateTrunkDto } from './dto/create-trunk.dto';
import { UpdateTrunkDto } from './dto/update-trunk.dto';
import { SipTrunkEntity } from './entities/sip-trunk.entity';

export interface TrunkResponse {
  id: number;
  name: string;
  providerPreset: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  fromDomain: string | null;
  fromUser: string | null;
  enabled: boolean;
  createdAt: string;
}

type TrunkTestStatus = 'dialing' | 'answered' | 'completed' | 'failed';

interface TrunkTestStatusResponse {
  status: TrunkTestStatus;
  reason: string | null;
}

@Injectable()
export class TrunksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrunksService.name);
  private redisPublisher: RedisClientType | null = null;

  constructor(
    @InjectRepository(SipTrunkEntity)
    private readonly trunksRepository: Repository<SipTrunkEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly asteriskConfigService: AsteriskConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisPublisher) {
      await this.redisPublisher.disconnect().catch(() => undefined);
      this.redisPublisher = null;
    }
  }

  async list(limit = 20, offset = 0): Promise<{ data: TrunkResponse[]; total: number }> {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);
    const [items, total] = await this.trunksRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      take: safeLimit,
      skip: safeOffset,
    });

    return {
      data: items.map((item) => this.toResponse(item)),
      total,
    };
  }

  async create(dto: CreateTrunkDto): Promise<{ data: TrunkResponse }> {
    const entity = this.trunksRepository.create({
      name: this.normalizeRequired(dto.name, 'name'),
      providerPreset: this.normalizePreset(dto.providerPreset),
      host: this.normalizeRequired(dto.host, 'host'),
      port: dto.port ?? 5060,
      username: this.normalizeOptional(dto.username),
      password: this.normalizeOptional(dto.password),
      fromDomain: this.normalizeOptional(dto.fromDomain),
      fromUser: this.normalizePhone(dto.fromUser),
      enabled: dto.enabled ?? true,
    });

    this.validateAuth(entity.username, entity.password);

    const saved = await this.trunksRepository.save(entity);
    await this.asteriskConfigService.writeTrunksConfig();
    await this.asteriskConfigService.reloadResPjsip();
    return { data: this.toResponse(saved) };
  }

  async update(id: number, dto: UpdateTrunkDto): Promise<{ data: TrunkResponse }> {
    const entity = await this.trunksRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Trunk ${id} not found`);
    }

    if (dto.name !== undefined) {
      entity.name = this.normalizeRequired(dto.name, 'name');
    }

    if (dto.providerPreset !== undefined) {
      entity.providerPreset = this.normalizePreset(dto.providerPreset);
    }

    if (dto.host !== undefined) {
      entity.host = this.normalizeRequired(dto.host, 'host');
    }

    if (dto.port !== undefined) {
      entity.port = dto.port;
    }

    if (dto.username !== undefined) {
      entity.username = this.normalizeOptional(dto.username);
      if (!entity.username) {
        entity.password = null;
      }
    }

    if (dto.password !== undefined) {
      entity.password = this.normalizeOptional(dto.password);
    }

    if (dto.fromDomain !== undefined) {
      entity.fromDomain = this.normalizeOptional(dto.fromDomain);
    }

    if (dto.fromUser !== undefined) {
      entity.fromUser = this.normalizePhone(dto.fromUser);
    }

    if (dto.enabled !== undefined) {
      entity.enabled = dto.enabled;
    }

    this.validateAuth(entity.username, entity.password);

    const saved = await this.trunksRepository.save(entity);
    await this.asteriskConfigService.writeTrunksConfig();
    await this.asteriskConfigService.reloadResPjsip();
    return { data: this.toResponse(saved) };
  }

  async remove(id: number): Promise<void> {
    const entity = await this.trunksRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Trunk ${id} not found`);
    }

    await this.trunksRepository.delete({ id });
    await this.asteriskConfigService.writeTrunksConfig();
    await this.asteriskConfigService.reloadResPjsip();
  }

  async test(id: number): Promise<AmiQualifyResult> {
    const entity = await this.requireTrunk(id);

    this.logger.log(`Testing trunk id=${entity.id} host=${entity.host} port=${entity.port}`);
    this.logger.log(`Attempting TCP connect to ${entity.host}:${entity.port} timeout=4000ms`);

    const probe = await this.tcpPing(entity.host, entity.port, 4000);

    if (probe.rtt_ms !== null) {
      this.logger.log(`TCP connect success id=${entity.id} rtt_ms=${probe.rtt_ms}`);
      const result: AmiQualifyResult = {
        status: 'reachable',
        rtt_ms: probe.rtt_ms,
        message: `Reachable — ${probe.rtt_ms}ms`,
      };
      this.logger.log(`Trunk test result id=${entity.id} status=${result.status} rtt_ms=${result.rtt_ms}`);
      return result;
    }

    this.logger.warn(`TCP connect failed id=${entity.id} host=${entity.host} port=${entity.port} error=${probe.errorCode ?? probe.message}`);
    const result: AmiQualifyResult = {
      status: 'unreachable',
      rtt_ms: null,
      message: probe.message,
    };
    this.logger.log(`Trunk test result id=${entity.id} status=${result.status} rtt_ms=${result.rtt_ms}`);
    return result;
  }

  async testOutbound(id: number, payload: { number: string; audioFileId?: number | null }): Promise<{ testCallId: string }> {
    await this.requireTrunk(id);

    const number = String(payload.number || '').trim();
    if (!number) {
      throw new BadRequestException('number is required');
    }

    const audioFileId = payload.audioFileId === undefined || payload.audioFileId === null
      ? null
      : Number(payload.audioFileId);

    if (audioFileId !== null && (!Number.isFinite(audioFileId) || audioFileId <= 0)) {
      throw new BadRequestException('audioFileId must be a positive number');
    }

    const testCallId = randomUUID();
    await this.publishRedis('trunk:test:outbound', {
      trunkId: id,
      number,
      audioFileId,
      testCallId,
    });
    return { testCallId };
  }

  async testInbound(id: number): Promise<{ testCallId: string }> {
    await this.requireTrunk(id);
    const testCallId = randomUUID();
    await this.publishRedis('trunk:test:inbound', {
      trunkId: id,
      testCallId,
    });
    return { testCallId };
  }

  async getTestCallStatus(id: number, testCallId: string): Promise<TrunkTestStatusResponse> {
    await this.requireTrunk(id);
    const normalizedTestCallId = String(testCallId || '').trim();
    if (!normalizedTestCallId) {
      throw new BadRequestException('testCallId is required');
    }

    const redis = await this.getRedisPublisher();
    const value = await redis.get(`trunk:test:${normalizedTestCallId}:status`);
    if (!value) {
      return { status: 'failed', reason: 'status unavailable or expired' };
    }

    try {
      const parsed = JSON.parse(value) as Partial<TrunkTestStatusResponse>;
      if (
        parsed.status === 'dialing'
        || parsed.status === 'answered'
        || parsed.status === 'completed'
        || parsed.status === 'failed'
      ) {
        return {
          status: parsed.status,
          reason: parsed.reason ? String(parsed.reason) : null,
        };
      }
    } catch {
      // fallback below
    }

    if (value === 'dialing' || value === 'answered' || value === 'completed' || value === 'failed') {
      return { status: value, reason: null };
    }

    return { status: 'failed', reason: 'invalid status payload' };
  }

  private async publishRedis(channel: string, payload: unknown): Promise<void> {
    const redis = await this.getRedisPublisher();
    await redis.publish(channel, JSON.stringify(payload));
  }

  private async getRedisPublisher(): Promise<RedisClientType> {
    if (!this.redisPublisher) {
      const redisPort = Number(process.env.REDIS_PORT || 6379);
      this.redisPublisher = createClient({
        socket: {
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: redisPort,
        },
      });
      this.redisPublisher.on('error', (error) => {
        this.logger.warn(`trunk redis publisher error: ${error instanceof Error ? error.message : String(error)}`);
      });
      await this.redisPublisher.connect();
    }
    return this.redisPublisher;
  }

  private async requireTrunk(id: number): Promise<SipTrunkEntity> {
    const entity = await this.trunksRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Trunk ${id} not found`);
    }
    return entity;
  }

  private toResponse(item: SipTrunkEntity): TrunkResponse {
    return {
      id: item.id,
      name: item.name,
      providerPreset: item.providerPreset,
      host: item.host,
      port: item.port,
      username: item.username,
      password: item.password,
      fromDomain: item.fromDomain,
      fromUser: item.fromUser,
      enabled: item.enabled,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private normalizeRequired(value: string | undefined, field: string): string {
    const normalized = (value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }

  private normalizeOptional(value?: string): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizePreset(value?: string): string {
    const normalized = value?.trim();
    return normalized || 'generic';
  }

  private normalizePhone(value?: string): string | null {
    const normalized = value?.trim().replace(/\s+/g, '');
    return normalized ? normalized : null;
  }

  private validateAuth(username: string | null, password: string | null): void {
    if (username && !password) {
      throw new BadRequestException('password is required when username is provided');
    }
  }

  private tcpPing(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<{ rtt_ms: number | null; message: string; errorCode?: string }> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (result: { rtt_ms: number | null; message: string; errorCode?: string }) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(timeoutMs);
      socket.connect(port, host, () => {
        finish({ rtt_ms: Date.now() - startedAt, message: 'Reachable' });
      });
      socket.on('timeout', () => {
        finish({ rtt_ms: null, message: `Timed out after ${timeoutMs}ms`, errorCode: 'ETIMEDOUT' });
      });
      socket.on('error', (error: NodeJS.ErrnoException) => {
        const message = error.code === 'ECONNREFUSED'
          ? 'Connection refused'
          : error.code === 'ENOTFOUND'
            ? 'Host not found'
            : error.code === 'EHOSTUNREACH'
              ? 'Host unreachable'
              : error.code === 'ENETUNREACH'
                ? 'Network unreachable'
                : error.message || 'Unreachable';

        finish({ rtt_ms: null, message, errorCode: error.code });
      });
    });
  }
}
