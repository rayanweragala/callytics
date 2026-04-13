import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { CallFlowEntity } from './entities/call-flow.entity';
import { FlowEdgeEntity } from './entities/flow-edge.entity';
import { FlowNodeEntity } from './entities/flow-node.entity';
import { FlowVersionEntity } from './entities/flow-version.entity';

interface FlowListItem {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

interface FlowNodeResponse {
  id: number;
  nodeKey: string;
  type: string;
  label: string | null;
  positionX: number;
  positionY: number;
  config: Record<string, unknown>;
}

interface FlowEdgeResponse {
  id: number;
  sourceNodeKey: string;
  targetNodeKey: string;
  branchKey: string;
  condition: string | null;
}

interface FlowDetailResponse {
  id: number;
  name: string;
  description: string | null;
  slug: string;
  createdAt: string;
  updatedAt: string;
  versionId: number;
  versionNumber: number;
  nodes: FlowNodeResponse[];
  edges: FlowEdgeResponse[];
}

@Injectable()
export class FlowsService implements OnModuleInit {

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(
      `ALTER TABLE flow_edges ADD COLUMN IF NOT EXISTS condition VARCHAR(100)`
    );
  }

  constructor(
    @InjectRepository(CallFlowEntity)
    private readonly callFlowsRepository: Repository<CallFlowEntity>,
    @InjectRepository(FlowVersionEntity)
    private readonly flowVersionsRepository: Repository<FlowVersionEntity>,
    @InjectRepository(FlowNodeEntity)
    private readonly flowNodesRepository: Repository<FlowNodeEntity>,
    @InjectRepository(FlowEdgeEntity)
    private readonly flowEdgesRepository: Repository<FlowEdgeEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(page = 1, limit = 5): Promise<{ data: FlowListItem[]; total: number; page: number; limit: number; totalPages: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const [flows, total] = await this.callFlowsRepository.findAndCount({
      order: { createdAt: 'ASC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const data = flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      description: flow.description,
      createdAt: flow.createdAt.toISOString(),
    }));

    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async findOne(id: number): Promise<{ data: FlowDetailResponse }> {
    const flow = await this.callFlowsRepository.findOne({ where: { id } });
    if (!flow) {
      throw new NotFoundException(`Flow ${id} not found`);
    }

    const versionId = flow.currentVersionId;
    if (!versionId) {
      const latestVersion = await this.flowVersionsRepository.findOne({
        where: { flowId: flow.id },
        order: { versionNumber: 'DESC' },
      });
      if (!latestVersion) {
        throw new NotFoundException(`Flow ${id} has no versions`);
      }
      return { data: await this.buildFlowDetail(flow, latestVersion) };
    }

    const version = await this.flowVersionsRepository.findOne({ where: { id: versionId } });
    if (!version) {
      throw new NotFoundException(`Flow ${id} version ${versionId} not found`);
    }

    return { data: await this.buildFlowDetail(flow, version) };
  }

  async create(dto: CreateFlowDto): Promise<{ data: FlowDetailResponse }> {
    return this.dataSource.transaction(async (manager) => {
      const slug = dto.slug?.trim() || this.slugify(dto.name);

      const flow = manager.create(CallFlowEntity, {
        name: dto.name,
        description: dto.description ?? null,
        slug,
        status: 'published',
        entryType: 'default',
        entryValue: null,
        currentVersionId: null,
      });
      const savedFlow = await manager.save(CallFlowEntity, flow);

      const version = manager.create(FlowVersionEntity, {
        flowId: savedFlow.id,
        versionNumber: 1,
        isPublished: true,
        publishedAt: new Date(),
      });
      const savedVersion = await manager.save(FlowVersionEntity, version);

      savedFlow.currentVersionId = savedVersion.id;
      savedFlow.updatedAt = new Date();
      await manager.save(CallFlowEntity, savedFlow);

      await this.saveNodesAndEdges(manager, savedVersion.id, dto.nodes, dto.edges);

      const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: savedFlow.id } });
      const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: savedVersion.id } });

      return {
        data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
      };
    });
  }

  async update(id: number, dto: UpdateFlowDto): Promise<{ data: FlowDetailResponse }> {
    return this.dataSource.transaction(async (manager) => {
      const flow = await manager.findOne(CallFlowEntity, { where: { id } });
      if (!flow) {
        throw new NotFoundException(`Flow ${id} not found`);
      }

      const previousVersion = await manager.findOne(FlowVersionEntity, {
        where: { flowId: flow.id },
        order: { versionNumber: 'DESC' },
      });
      const nextVersionNumber = (previousVersion?.versionNumber ?? 0) + 1;

      flow.name = dto.name;
      flow.description = dto.description ?? null;
      flow.slug = dto.slug?.trim() || flow.slug || this.slugify(dto.name);
      flow.updatedAt = new Date();
      await manager.save(CallFlowEntity, flow);

      const version = manager.create(FlowVersionEntity, {
        flowId: flow.id,
        versionNumber: nextVersionNumber,
        isPublished: true,
        publishedAt: new Date(),
      });
      const savedVersion = await manager.save(FlowVersionEntity, version);

      flow.currentVersionId = savedVersion.id;
      await manager.save(CallFlowEntity, flow);

      await this.saveNodesAndEdges(manager, savedVersion.id, dto.nodes, dto.edges);

      const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
      const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: savedVersion.id } });

      return {
        data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
      };
    });
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    return this.dataSource.transaction(async (manager) => {
      const flow = await manager.findOne(CallFlowEntity, { where: { id } });
      if (!flow) {
        throw new NotFoundException(`Flow ${id} not found`);
      }

      const versions = await manager.find(FlowVersionEntity, { where: { flowId: flow.id } });
      const versionIds = versions.map((version) => version.id);

      if (versionIds.length > 0) {
        await manager
          .createQueryBuilder()
          .delete()
          .from(FlowEdgeEntity)
          .where('flow_version_id IN (:...versionIds)', { versionIds })
          .execute();
        await manager
          .createQueryBuilder()
          .delete()
          .from(FlowNodeEntity)
          .where('flow_version_id IN (:...versionIds)', { versionIds })
          .execute();
        await manager
          .createQueryBuilder()
          .delete()
          .from(FlowVersionEntity)
          .where('id IN (:...versionIds)', { versionIds })
          .execute();
      }

      await manager.delete(CallFlowEntity, { id: flow.id });
      return { data: { id: flow.id, deleted: true as const } };
    });
  }

  private async saveNodesAndEdges(
    manager: DataSource['manager'],
    versionId: number,
    nodes: CreateFlowDto['nodes'],
    edges: CreateFlowDto['edges'],
  ): Promise<void> {
    const nodeEntities = nodes.map((node) =>
      manager.create(FlowNodeEntity, {
        flowVersionId: versionId,
        nodeKey: node.nodeKey,
        type: node.type,
        label: node.label ?? null,
        positionX: node.positionX ?? 0,
        positionY: node.positionY ?? 0,
        configJson: node.config ?? {},
      }),
    );
    await manager.save(FlowNodeEntity, nodeEntities);

    const edgeEntities = edges.map((edge) =>
      manager.create(FlowEdgeEntity, {
        flowVersionId: versionId,
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey ?? edge.condition ?? 'default',
        condition: edge.condition ?? null,
      }),
    );
    if (edgeEntities.length > 0) {
      await manager.save(FlowEdgeEntity, edgeEntities);
    }
  }

  private async buildFlowDetail(
    flow: CallFlowEntity,
    version: FlowVersionEntity,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<FlowDetailResponse> {
    const nodes = await manager.find(FlowNodeEntity, {
      where: { flowVersionId: version.id },
      order: { id: 'ASC' },
    });
    const edges = await manager.find(FlowEdgeEntity, {
      where: { flowVersionId: version.id },
      order: { id: 'ASC' },
    });

    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      slug: flow.slug,
      createdAt: flow.createdAt.toISOString(),
      updatedAt: flow.updatedAt.toISOString(),
      versionId: version.id,
      versionNumber: version.versionNumber,
      nodes: nodes.map((node) => ({
        id: node.id,
        nodeKey: node.nodeKey,
        type: node.type,
        label: node.label,
        positionX: node.positionX,
        positionY: node.positionY,
        config: node.configJson,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey,
        condition: edge.condition ?? null,
      })),
    };
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `flow-${Date.now()}`;
  }
}
