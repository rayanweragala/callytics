import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { SettingsEntity } from './settings.entity';

export type SettingValue = boolean | number | string | null;

export type SettingsMap = Record<string, SettingValue>;

const SETTING_DEFAULTS: SettingsMap = {
  default_outbound_trunk_id: null,
  record_outbound_calls: false,
  recording_retention_days: 0,
};

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
    @InjectRepository(SipTrunkEntity)
    private readonly trunksRepository: Repository<SipTrunkEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await runSqlMigrations(this.dataSource);
      await this.seedDefaults();
    } catch (error: unknown) {
      this.logger.error(
        `failed to initialize settings: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async get(key: string): Promise<SettingValue | null> {
    try {
      await this.seedDefaults();
      const item = await this.settingsRepository.findOne({ where: { key } });
      return this.deserializeValue(key, item?.value ?? null);
    } catch (error: unknown) {
      this.logger.error(
        `failed to read setting ${key}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async getAll(): Promise<SettingsMap> {
    try {
      await this.seedDefaults();
      const items = await this.settingsRepository.find({ order: { key: 'ASC' } });
      return items.reduce<SettingsMap>((accumulator, item) => {
        accumulator[item.key] = this.deserializeValue(item.key, item.value);
        return accumulator;
      }, {});
    } catch (error: unknown) {
      this.logger.error(
        `failed to read settings: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  async set(key: string, value: SettingValue): Promise<void> {
    try {
      await this.seedDefaults();
      const normalizedValue = await this.normalizeValue(key, value);
      const existing = await this.settingsRepository.findOne({ where: { key } });
      const entity = existing
        ? this.settingsRepository.merge(existing, { value: normalizedValue })
        : this.settingsRepository.create({ key, value: normalizedValue });
      await this.settingsRepository.save(entity);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        this.logger.debug(`Validation error for setting ${key}: ${error.message}`);
      } else {
        this.logger.error(
          `failed to persist setting ${key}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
      throw error;
    }
  }

  async updateMany(patch: Record<string, SettingValue>): Promise<SettingsMap> {
    const entries = Object.entries(patch);
    for (const [key, value] of entries) {
      await this.set(key, value);
    }
    return this.getAll();
  }

  async getDefaultTrunk(): Promise<{ data: SipTrunkEntity | null }> {
    try {
      const configuredTrunkId = await this.get('default_outbound_trunk_id');
      if (typeof configuredTrunkId !== 'number' || configuredTrunkId <= 0) {
        return { data: null };
      }

      const trunk = await this.trunksRepository.findOne({
        where: {
          id: configuredTrunkId,
          enabled: true,
        },
      });

      return {
        data: trunk ?? null,
      };
    } catch (error: unknown) {
      this.logger.error(
        `failed to resolve default trunk: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async seedDefaults(): Promise<void> {
    try {
      for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
        const existing = await this.settingsRepository.findOne({ where: { key } });
        if (!existing) {
          await this.settingsRepository.save(this.settingsRepository.create({
            key,
            value: this.serializeValue(value),
          }));
        }
      }
    } catch (error: unknown) {
      this.logger.error(
        `failed to seed settings defaults: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async normalizeValue(key: string, value: SettingValue): Promise<string | null> {
    if (key === 'default_outbound_trunk_id') {
      if (value === null || value === '') {
        return null;
      }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw new BadRequestException('default_outbound_trunk_id must be a positive integer or null');
      }
      const trunk = await this.trunksRepository.findOne({ where: { id: value } });
      if (!trunk) {
        throw new BadRequestException(`Trunk ${value} not found`);
      }
      return String(value);
    }

    if (key === 'record_outbound_calls') {
      if (typeof value !== 'boolean') {
        throw new BadRequestException('record_outbound_calls must be a boolean');
      }
      return this.serializeValue(value);
    }

    if (key === 'recording_retention_days') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new BadRequestException('recording_retention_days must be a non-negative integer');
      }
      return this.serializeValue(value);
    }

    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new BadRequestException(`unsupported value type for setting ${key}`);
    }

    return this.serializeValue(value);
  }

  private deserializeValue(key: string, value: string | null): SettingValue {
    if (key === 'default_outbound_trunk_id') {
      if (value === null || value.trim() === '') {
        return null;
      }
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    if (key === 'record_outbound_calls') {
      return value === 'true';
    }

    if (key === 'recording_retention_days') {
      const parsed = Number(value ?? '');
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    }

    return value;
  }

  private serializeValue(value: SettingValue): string | null {
    if (value === null) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    return String(value);
  }
}
