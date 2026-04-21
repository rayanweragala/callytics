import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { CreateQueueDto } from './dto/create-queue.dto';
import { UpdateQueueDto } from './dto/update-queue.dto';
import { QueueEntity } from './entities/queue.entity';

export interface QueueOperatorRow {
  id: number;
  name: string;
}

export interface QueueResponse {
  id: number;
  name: string;
  slug: string;
  waitAudioFileId: number | null;
  maxWaitSeconds: number;
  pinRetryAttempts: number;
  operatorCount: number;
  operatorIds: number[];
  operators: QueueOperatorRow[];
  createdAt: string;
}

@Injectable()
export class QueuesService {
  constructor(
    @InjectRepository(QueueEntity)
    private readonly queuesRepository: Repository<QueueEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private async ensureUniqueSlug(base: string, excludeId?: number): Promise<string> {
    let slug = base;
    let attempt = 0;
    while (true) {
      const existing = await this.queuesRepository.findOne({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
      attempt++;
      slug = `${base}-${attempt}`;
    }
  }

  private async loadOperatorsForQueue(queueId: number): Promise<QueueOperatorRow[]> {
    const rows = await this.dataSource.query(
      `SELECT o.id, o.name
       FROM queue_operators qo
       JOIN operators o ON o.id = qo.operator_id
       WHERE qo.queue_id = $1
       ORDER BY o.name ASC`,
      [queueId],
    );
    return rows as QueueOperatorRow[];
  }

  private async toResponse(item: QueueEntity): Promise<QueueResponse> {
    const operators = await this.loadOperatorsForQueue(item.id);
    return {
      id: item.id,
      name: item.name,
      slug: item.slug,
      waitAudioFileId: item.waitAudioFileId,
      maxWaitSeconds: item.maxWaitSeconds,
      pinRetryAttempts: item.pinRetryAttempts,
      operatorCount: operators.length,
      operatorIds: operators.map((op) => op.id),
      operators,
      createdAt: item.createdAt.toISOString(),
    };
  }

  async list(): Promise<{ data: QueueResponse[] }> {
    const items = await this.queuesRepository.find({ order: { name: 'ASC' } });
    const responses = await Promise.all(items.map((item) => this.toResponse(item)));
    return { data: responses };
  }

  async create(dto: CreateQueueDto): Promise<{ data: QueueResponse }> {
    const name = (dto.name || '').trim();
    if (!name) throw new BadRequestException('name is required');

    const slug = await this.ensureUniqueSlug(this.slugify(name));

    const entity = this.queuesRepository.create({
      name,
      slug,
      waitAudioFileId: dto.wait_audio_file_id ?? null,
      maxWaitSeconds: dto.max_wait_seconds ?? 300,
      pinRetryAttempts: dto.pin_retry_attempts ?? 3,
    });

    const saved = await this.queuesRepository.save(entity);
    await this.syncOperators(saved.id, dto.operator_ids ?? []);

    return { data: await this.toResponse(saved) };
  }

  async update(id: number, dto: UpdateQueueDto): Promise<{ data: QueueResponse }> {
    const entity = await this.queuesRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Queue ${id} not found`);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('name is required');
      entity.name = name;
      entity.slug = await this.ensureUniqueSlug(this.slugify(name), id);
    }
    if (dto.wait_audio_file_id !== undefined) entity.waitAudioFileId = dto.wait_audio_file_id ?? null;
    if (dto.max_wait_seconds !== undefined) entity.maxWaitSeconds = dto.max_wait_seconds;
    if (dto.pin_retry_attempts !== undefined) entity.pinRetryAttempts = dto.pin_retry_attempts;

    const saved = await this.queuesRepository.save(entity);

    if (dto.operator_ids !== undefined) {
      await this.syncOperators(saved.id, dto.operator_ids);
    }

    return { data: await this.toResponse(saved) };
  }

  async remove(id: number): Promise<void> {
    const entity = await this.queuesRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Queue ${id} not found`);
    await this.queuesRepository.delete({ id });
  }

  private async syncOperators(queueId: number, operatorIds: number[]): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM queue_operators WHERE queue_id = $1`,
      [queueId],
    );
    if (operatorIds.length === 0) return;
    const values = operatorIds
      .map((_, i) => `($1, $${i + 2})`)
      .join(', ');
    await this.dataSource.query(
      `INSERT INTO queue_operators (queue_id, operator_id) VALUES ${values} ON CONFLICT DO NOTHING`,
      [queueId, ...operatorIds],
    );
  }
}
