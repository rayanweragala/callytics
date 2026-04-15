import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { CreateInboundRouteDto } from './dto/create-inbound-route.dto';
import { UpdateInboundRouteDto } from './dto/update-inbound-route.dto';
import { InboundRouteEntity } from './entities/inbound-route.entity';

export interface InboundRouteResponse {
  id: number;
  did: string;
  flowId: number;
  flowName: string | null;
  label: string | null;
  createdAt: string;
}

@Injectable()
export class InboundRoutesService implements OnModuleInit {
  constructor(
    @InjectRepository(InboundRouteEntity)
    private readonly inboundRoutesRepository: Repository<InboundRouteEntity>,
    @InjectRepository(CallFlowEntity)
    private readonly flowsRepository: Repository<CallFlowEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly asteriskConfigService: AsteriskConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    const routes = await this.inboundRoutesRepository.find({ order: { did: 'ASC' } });
    await this.asteriskConfigService.writeInboundRoutesConfig(routes);
  }

  async list(did?: string, limit = 20, offset = 0): Promise<{ data: InboundRouteResponse[]; total: number }> {
    const where = did?.trim() ? { did: did.trim() } : undefined;
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);
    const [items, total] = await this.inboundRoutesRepository.findAndCount({
      where,
      order: { did: 'ASC' },
      take: safeLimit,
      skip: safeOffset,
    });
    const flowNames = await this.loadFlowNames(items.map((item) => item.flowId));
    return {
      data: items.map((item) => this.toResponse(item, flowNames)),
      total,
    };
  }

  async create(dto: CreateInboundRouteDto): Promise<{ data: InboundRouteResponse }> {
    const did = this.normalizeRequired(dto.did, 'did');
    await this.ensureFlowExists(dto.flowId);
    const existing = await this.inboundRoutesRepository.findOne({ where: { did } });
    if (existing) {
      throw new BadRequestException(`Inbound route DID ${did} already exists`);
    }

    const entity = this.inboundRoutesRepository.create({
      did,
      flowId: dto.flowId,
      label: this.normalizeOptional(dto.label),
    });
    const saved = await this.inboundRoutesRepository.save(entity);
    await this.rebuildConfig();
    const flowNames = await this.loadFlowNames([saved.flowId]);
    return { data: this.toResponse(saved, flowNames) };
  }

  async update(id: number, dto: UpdateInboundRouteDto): Promise<{ data: InboundRouteResponse }> {
    const entity = await this.inboundRoutesRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Inbound route ${id} not found`);
    }

    if (dto.did !== undefined) {
      const did = this.normalizeRequired(dto.did, 'did');
      const conflict = await this.inboundRoutesRepository.findOne({ where: { did } });
      if (conflict && conflict.id !== id) {
        throw new BadRequestException(`Inbound route DID ${did} already exists`);
      }
      entity.did = did;
    }

    if (dto.flowId !== undefined) {
      await this.ensureFlowExists(dto.flowId);
      entity.flowId = dto.flowId;
    }

    if (dto.label !== undefined) {
      entity.label = this.normalizeOptional(dto.label);
    }

    const saved = await this.inboundRoutesRepository.save(entity);
    await this.rebuildConfig();
    const flowNames = await this.loadFlowNames([saved.flowId]);
    return { data: this.toResponse(saved, flowNames) };
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const entity = await this.inboundRoutesRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Inbound route ${id} not found`);
    }

    await this.inboundRoutesRepository.delete({ id });
    await this.rebuildConfig();
    return { data: { id, deleted: true } };
  }

  private async rebuildConfig(): Promise<void> {
    const routes = await this.inboundRoutesRepository.find({ order: { did: 'ASC' } });
    await this.asteriskConfigService.syncInboundRoutes(routes);
  }

  private async ensureFlowExists(flowId: number): Promise<void> {
    const flow = await this.flowsRepository.findOne({ where: { id: flowId } });
    if (!flow) {
      throw new BadRequestException(`Flow ${flowId} not found`);
    }
  }

  private async loadFlowNames(flowIds: number[]): Promise<Map<number, string>> {
    const uniqueIds = Array.from(new Set(flowIds.filter((value) => typeof value === 'number')));
    if (uniqueIds.length === 0) {
      return new Map();
    }
    const flows = await this.flowsRepository.find({ where: { id: In(uniqueIds) } });
    return new Map(flows.map((flow) => [flow.id, flow.name]));
  }

  private toResponse(item: InboundRouteEntity, flowNames: Map<number, string>): InboundRouteResponse {
    return {
      id: item.id,
      did: item.did,
      flowId: item.flowId,
      flowName: flowNames.get(item.flowId) || null,
      label: item.label,
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
}
