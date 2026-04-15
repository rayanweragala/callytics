import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
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
  groupId: string | null;
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

interface FlowVersionSnapshot {
  nodes: Array<{
    nodeKey: string;
    type: string;
    label: string | null;
    positionX: number;
    positionY: number;
    config: Record<string, unknown>;
    groupId: string | null;
  }>;
  edges: Array<{
    sourceNodeKey: string;
    targetNodeKey: string;
    branchKey: string;
    condition: string | null;
  }>;
}

interface FlowVersionSummaryResponse {
  id: number;
  flowId: number;
  versionNum: number;
  message: string;
  nodeCount: number;
  createdAt: string;
}

interface FlowVersionDetailResponse extends FlowVersionSummaryResponse {
  snapshot: FlowVersionSnapshot;
}

const DEFAULT_EDITOR_VERSION_MESSAGE = 'Saved from editor';

@Injectable()
export class FlowsService implements OnModuleInit {

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
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
      const slug = await this.ensureUniqueSlug(manager.getRepository(CallFlowEntity), dto.slug?.trim() || this.slugify(dto.name));

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

      const savedVersion = await this.createStoredVersion(
        manager,
        savedFlow.id,
        1,
        this.buildSnapshotFromPayload(dto.nodes, dto.edges),
        dto.versionMessage,
      );

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

      const savedVersion = await this.createStoredVersion(
        manager,
        flow.id,
        nextVersionNumber,
        this.buildSnapshotFromPayload(dto.nodes, dto.edges),
        dto.versionMessage,
      );

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

  async listVersions(id: number): Promise<{ data: FlowVersionSummaryResponse[] }> {
    await this.ensureFlowExists(id);
    const versions = await this.flowVersionsRepository.find({
      where: { flowId: id },
      order: { versionNumber: 'DESC' },
    });

    return {
      data: versions
        .filter((version) => Boolean(version.snapshot && version.nodeCount !== null))
        .map((version) => this.mapFlowVersionSummary(version)),
    };
  }

  async findVersion(id: number, versionId: number): Promise<{ data: FlowVersionDetailResponse }> {
    await this.ensureFlowExists(id);
    const version = await this.flowVersionsRepository.findOne({ where: { id: versionId, flowId: id } });
    if (!version || !version.snapshot || version.nodeCount === null) {
      throw new NotFoundException(`Flow ${id} version ${versionId} not found`);
    }

    return { data: this.mapFlowVersionDetail(version) };
  }

  async createVersion(id: number, message: string): Promise<{ data: FlowVersionSummaryResponse }> {
    return this.dataSource.transaction(async (manager) => {
      const flow = await manager.findOne(CallFlowEntity, { where: { id } });
      if (!flow) {
        throw new NotFoundException(`Flow ${id} not found`);
      }

      const snapshot = await this.buildFlowSnapshot(flow, manager);
      const previousVersion = await manager.findOne(FlowVersionEntity, {
        where: { flowId: id },
        order: { versionNumber: 'DESC' },
      });
      const nextVersionNumber = (previousVersion?.versionNumber ?? 0) + 1;
      const saved = await this.createStoredVersion(manager, id, nextVersionNumber, snapshot, message);
      const persisted = await manager.findOneOrFail(FlowVersionEntity, { where: { id: saved.id } });
      return { data: this.mapFlowVersionSummary(persisted) };
    });
  }

  async restoreVersion(id: number, versionId: number): Promise<{ data: { success: true } }> {
    return this.dataSource.transaction(async (manager) => {
      const flow = await manager.findOne(CallFlowEntity, { where: { id } });
      if (!flow) {
        throw new NotFoundException(`Flow ${id} not found`);
      }

      const version = await manager.findOne(FlowVersionEntity, { where: { id: versionId, flowId: id } });
      if (!version || !version.snapshot) {
        throw new NotFoundException(`Flow ${id} version ${versionId} not found`);
      }

      const snapshot = version.snapshot as unknown as FlowVersionSnapshot;
      const previousVersion = await manager.findOne(FlowVersionEntity, {
        where: { flowId: id },
        order: { versionNumber: 'DESC' },
      });
      const nextVersionNumber = (previousVersion?.versionNumber ?? 0) + 1;
      const savedVersion = await this.createStoredVersion(
        manager,
        id,
        nextVersionNumber,
        snapshot,
        `Restored from v${version.versionNumber}`,
      );

      flow.currentVersionId = savedVersion.id;
      flow.name = flow.name.replace(/ Updated$/, '');
      flow.updatedAt = new Date();
      await manager.save(CallFlowEntity, flow);

      await this.saveNodesAndEdges(
        manager,
        savedVersion.id,
        snapshot.nodes.map((node) => ({
          nodeKey: node.nodeKey,
          type: node.type,
          label: node.label ?? undefined,
          positionX: node.positionX,
          positionY: node.positionY,
          config: node.config,
          groupId: node.groupId,
        })),
        snapshot.edges.map((edge) => ({
          sourceNodeKey: edge.sourceNodeKey,
          targetNodeKey: edge.targetNodeKey,
          branchKey: edge.branchKey,
          condition: edge.condition,
        })),
      );

      return { data: { success: true as const } };
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

  private async ensureFlowExists(id: number): Promise<void> {
    const flow = await this.callFlowsRepository.findOne({ where: { id } });
    if (!flow) {
      throw new NotFoundException(`Flow ${id} not found`);
    }
  }

  private async buildFlowSnapshot(
    flow: CallFlowEntity,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<FlowVersionSnapshot> {
    const detail = await this.findOne(flow.id);
    return {
      nodes: detail.data.nodes.map((node) => ({
        nodeKey: node.nodeKey,
        type: node.type,
        label: node.label,
        positionX: node.positionX,
        positionY: node.positionY,
        config: node.config,
        groupId: node.groupId,
      })),
      edges: detail.data.edges.map((edge) => ({
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey,
        condition: edge.condition,
      })),
    };
  }

  private buildSnapshotFromPayload(
    nodes: CreateFlowDto['nodes'],
    edges: CreateFlowDto['edges'],
  ): FlowVersionSnapshot {
    return {
      nodes: nodes.map((node) => ({
        nodeKey: node.nodeKey,
        type: node.type,
        label: node.label ?? null,
        positionX: node.positionX ?? 0,
        positionY: node.positionY ?? 0,
        config: node.config ?? {},
        groupId: node.groupId ?? null,
      })),
      edges: edges.map((edge) => ({
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey ?? 'default',
        condition: edge.condition ?? null,
      })),
    };
  }

  private async createStoredVersion(
    manager: DataSource['manager'],
    flowId: number,
    versionNumber: number,
    snapshot: FlowVersionSnapshot,
    message?: string | null,
  ): Promise<FlowVersionEntity> {
    const version = manager.create(FlowVersionEntity, {
      flowId,
      versionNumber,
      isPublished: true,
      publishedAt: new Date(),
      message: message?.trim() || DEFAULT_EDITOR_VERSION_MESSAGE,
      snapshot: snapshot as unknown as Record<string, unknown>,
      nodeCount: snapshot.nodes.length,
    });

    return manager.save(FlowVersionEntity, version);
  }

  private mapFlowVersionSummary(version: FlowVersionEntity): FlowVersionSummaryResponse {
    return {
      id: version.id,
      flowId: Number(version.flowId || 0),
      versionNum: version.versionNumber,
      message: String(version.message || ''),
      nodeCount: Number(version.nodeCount || 0),
      createdAt: version.createdAt.toISOString(),
    };
  }

  private mapFlowVersionDetail(version: FlowVersionEntity): FlowVersionDetailResponse {
    return {
      ...this.mapFlowVersionSummary(version),
      snapshot: version.snapshot as unknown as FlowVersionSnapshot,
    };
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
        groupId: node.groupId ?? null,
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
        groupId: node.groupId ?? null,
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

  private async ensureUniqueSlug(repository: Repository<CallFlowEntity>, candidate: string): Promise<string> {
    const base = candidate || 'untitled';
    let slug = base;
    const existing = await repository.findOne({ where: { slug } });
    if (existing) {
      slug = `${base}-${Date.now().toString(36)}`;
    }
    return slug;
  }
}
