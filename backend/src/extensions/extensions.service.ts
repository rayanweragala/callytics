import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { CreateExtensionDto } from './dto/create-extension.dto';
import { UpdateExtensionDto } from './dto/update-extension.dto';
import { SipExtensionEntity } from './entities/sip-extension.entity';

export interface ExtensionResponse {
  id: number;
  username: string;
  password: string;
  displayName: string | null;
  createdAt: string;
}

@Injectable()
export class ExtensionsService implements OnModuleInit {
  constructor(
    @InjectRepository(SipExtensionEntity)
    private readonly extensionsRepository: Repository<SipExtensionEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly asteriskConfigService: AsteriskConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.rebuildConfig();
  }

  async list(limit = 20, offset = 0): Promise<{ data: ExtensionResponse[]; total: number }> {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);
    const [items, total] = await this.extensionsRepository.findAndCount({
      order: { username: 'ASC' },
      take: safeLimit,
      skip: safeOffset,
    });
    return {
      data: items.map((item) => this.toResponse(item)),
      total,
    };
  }

  async create(dto: CreateExtensionDto): Promise<{ data: ExtensionResponse }> {
    const username = this.normalizeRequired(dto.username, 'username');
    const password = this.normalizeRequired(dto.password, 'password');
    const existing = await this.extensionsRepository.findOne({ where: { username } });
    if (existing) {
      throw new BadRequestException(`Extension username ${username} already exists`);
    }

    const entity = this.extensionsRepository.create({
      username,
      password,
      displayName: this.normalizeOptional(dto.displayName),
    });
    const saved = await this.extensionsRepository.save(entity);
    await this.rebuildConfig();
    return { data: this.toResponse(saved) };
  }

  async update(id: number, dto: UpdateExtensionDto): Promise<{ data: ExtensionResponse }> {
    const entity = await this.extensionsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Extension ${id} not found`);
    }

    if (dto.username !== undefined) {
      const username = this.normalizeRequired(dto.username, 'username');
      const conflict = await this.extensionsRepository.findOne({ where: { username } });
      if (conflict && conflict.id !== id) {
        throw new BadRequestException(`Extension username ${username} already exists`);
      }
      entity.username = username;
    }

    if (dto.password !== undefined) {
      entity.password = this.normalizeRequired(dto.password, 'password');
    }

    if (dto.displayName !== undefined) {
      entity.displayName = this.normalizeOptional(dto.displayName);
    }

    const saved = await this.extensionsRepository.save(entity);
    await this.rebuildConfig();
    return { data: this.toResponse(saved) };
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const entity = await this.extensionsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Extension ${id} not found`);
    }

    await this.extensionsRepository.delete({ id });
    await this.rebuildConfig();
    return { data: { id, deleted: true } };
  }

  private async rebuildConfig(): Promise<void> {
    const extensions = await this.extensionsRepository.find({ order: { username: 'ASC' } });
    await this.asteriskConfigService.syncExtensions(extensions);
  }

  private toResponse(item: SipExtensionEntity): ExtensionResponse {
    return {
      id: item.id,
      username: item.username,
      password: item.password,
      displayName: item.displayName,
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

  private async ensureSchema(): Promise<void> {
    const migrationPath = join(process.cwd(), 'src', 'db', 'migrations', '013_phase13_extensions_and_inbound_routes.sql');
    const sql = await fs.readFile(migrationPath, 'utf8');
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await this.dataSource.query(statement);
    }
  }
}
