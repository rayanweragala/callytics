import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';

export interface SettingsResponse {
  default_outbound_trunk_id: number | null;
  record_outbound_calls: boolean;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SipTrunkEntity)
    private readonly trunksRepository: Repository<SipTrunkEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.ensureSettingsRow();
  }

  async getSettings(): Promise<{ data: SettingsResponse }> {
    return {
      data: await this.readSettings(),
    };
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<{ data: SettingsResponse }> {
    await this.ensureSettingsRow();

    const nextDefaultTrunkId = dto.default_outbound_trunk_id === undefined
      ? undefined
      : dto.default_outbound_trunk_id === null
        ? null
        : Number(dto.default_outbound_trunk_id);

    if (nextDefaultTrunkId !== undefined && nextDefaultTrunkId !== null) {
      const trunk = await this.trunksRepository.findOne({ where: { id: nextDefaultTrunkId } });
      if (!trunk) {
        throw new BadRequestException(`Trunk ${nextDefaultTrunkId} not found`);
      }
    }

    const current = await this.readSettings();
    const nextRecordOutboundCalls = dto.record_outbound_calls === undefined
      ? current.record_outbound_calls
      : Boolean(dto.record_outbound_calls);
    const persistedDefaultTrunkId = nextDefaultTrunkId === undefined
      ? current.default_outbound_trunk_id
      : nextDefaultTrunkId;

    await this.dataSource.query(
      `
        UPDATE settings
        SET default_outbound_trunk_id = $2,
            record_outbound_calls = $3
        WHERE id = $1
      `,
      [1, persistedDefaultTrunkId, nextRecordOutboundCalls],
    );

    return {
      data: await this.readSettings(),
    };
  }

  async getDefaultTrunk(): Promise<{ data: SipTrunkEntity | null }> {
    const settings = await this.readSettings();
    if (!settings.default_outbound_trunk_id) {
      return { data: null };
    }

    const trunk = await this.trunksRepository.findOne({
      where: {
        id: settings.default_outbound_trunk_id,
        enabled: true,
      },
    });

    return {
      data: trunk ?? null,
    };
  }

  private async readSettings(): Promise<SettingsResponse> {
    await this.ensureSettingsRow();
    const rows = await this.dataSource.query(
      `
        SELECT
          default_outbound_trunk_id,
          record_outbound_calls
        FROM settings
        WHERE id = $1
        LIMIT 1
      `,
      [1],
    );

    return {
      default_outbound_trunk_id: rows[0]?.default_outbound_trunk_id === null
        ? null
        : Number(rows[0]?.default_outbound_trunk_id || 0) || null,
      record_outbound_calls: Boolean(rows[0]?.record_outbound_calls),
    };
  }

  private async ensureSettingsRow(): Promise<void> {
    await this.dataSource.query(
      `
        INSERT INTO settings (id, default_outbound_trunk_id, record_outbound_calls)
        VALUES ($1, NULL, false)
        ON CONFLICT (id) DO NOTHING
      `,
      [1],
    );
  }
}
