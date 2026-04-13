import { Injectable, NotFoundException, OnModuleInit, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { DataSource, In, Repository } from 'typeorm';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { CallRecordingEntity } from './entities/call-recording.entity';

export interface RecordingResponse {
  id: number;
  callId: string;
  channelId: string;
  flowId: number | null;
  flowName: string | null;
  fileName: string;
  filePath: string;
  format: string;
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  streamUrl: string;
}

@Injectable()
export class RecordingsService implements OnModuleInit {
  constructor(
    @InjectRepository(CallRecordingEntity)
    private readonly recordingsRepository: Repository<CallRecordingEntity>,
    @InjectRepository(CallFlowEntity)
    private readonly flowsRepository: Repository<CallFlowEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
  }

  async list(page = 1, limit = 20): Promise<{ data: RecordingResponse[]; total: number; page: number; limit: number; totalPages: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const [items, total] = await this.recordingsRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const flowNames = await this.loadFlowNames(items);
    return {
      data: items.map((item) => this.toResponse(item, flowNames)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async getOne(id: number): Promise<{ data: RecordingResponse }> {
    const item = await this.recordingsRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Recording ${id} not found`);
    const flowNames = await this.loadFlowNames([item]);
    return { data: this.toResponse(item, flowNames) };
  }

  async createInternal(dto: CreateRecordingDto): Promise<{ data: RecordingResponse }> {
    const normalizedFileName = basename(dto.fileName || '').trim();
    if (!normalizedFileName || normalizedFileName !== (dto.fileName || '').trim()) {
      throw new BadRequestException('Invalid recording file name');
    }

    const item = this.recordingsRepository.create({
      callId: dto.callId,
      channelId: dto.channelId,
      flowId: dto.flowId ?? null,
      fileName: normalizedFileName,
      filePath: join('/var/lib/asterisk/recording', normalizedFileName),
      format: dto.format || 'wav',
      durationSeconds: dto.durationSeconds ?? null,
      startedAt: new Date(dto.startedAt),
      endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
    });
    const saved = await this.recordingsRepository.save(item);
    const refreshed = await this.recordingsRepository.findOne({ where: { id: saved.id } });
    if (!refreshed) throw new NotFoundException(`Recording ${saved.id} not found after save`);
    const flowNames = await this.loadFlowNames([refreshed]);
    return { data: this.toResponse(refreshed, flowNames) };
  }

  async getFilePath(id: number): Promise<string> {
    const item = await this.recordingsRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Recording ${id} not found`);
    try {
      await fs.access(item.filePath);
    } catch {
      throw new NotFoundException(`Recording file for ${id} not found`);
    }
    return item.filePath;
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const item = await this.recordingsRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Recording ${id} not found`);

    try {
      await fs.unlink(item.filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT') {
        throw new InternalServerErrorException(`Failed to delete recording file for ${id}`);
      }
    }

    await this.recordingsRepository.delete({ id });
    return { data: { id, deleted: true } };
  }

  private async loadFlowNames(items: CallRecordingEntity[]): Promise<Map<number, string>> {
    const flowIds = Array.from(new Set(items.map((item) => item.flowId).filter((value): value is number => typeof value === 'number')));
    if (flowIds.length === 0) {
      return new Map();
    }

    const flows = await this.flowsRepository.find({ where: { id: In(flowIds) } });
    return new Map(flows.map((flow) => [flow.id, flow.name]));
  }

  private toResponse(item: CallRecordingEntity, flowNames: Map<number, string>): RecordingResponse {
    return {
      id: item.id,
      callId: item.callId,
      channelId: item.channelId,
      flowId: item.flowId,
      flowName: item.flowId ? flowNames.get(item.flowId) || null : null,
      fileName: item.fileName,
      filePath: item.filePath,
      format: item.format,
      durationSeconds: item.durationSeconds,
      startedAt: item.startedAt.toISOString(),
      endedAt: item.endedAt ? item.endedAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
      streamUrl: `/recordings/${item.id}/stream`,
    };
  }

  private async ensureSchema(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS call_recordings (
        id SERIAL PRIMARY KEY,
        call_id VARCHAR(255) NOT NULL,
        channel_id VARCHAR(255) NOT NULL,
        flow_id INTEGER REFERENCES call_flows(id) ON DELETE SET NULL,
        file_name VARCHAR(500) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        format VARCHAR(20) NOT NULL DEFAULT 'wav',
        duration_seconds INTEGER,
        started_at TIMESTAMPTZ NOT NULL,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_call_recordings_call_id ON call_recordings(call_id)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_call_recordings_created_at ON call_recordings(created_at)`);
  }
}
