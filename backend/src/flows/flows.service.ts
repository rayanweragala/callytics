import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
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
  subflowId: number | null;
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
  parentFlowId: number | null;
  parentNodeKey: string | null;
  createdAt: string;
  updatedAt: string;
  versionId: number;
  versionNumber: number;
  nodes: FlowNodeResponse[];
  edges: FlowEdgeResponse[];
}

interface FlowBreadcrumbItemResponse {
  flowId: number;
  flowName: string;
}

interface FlowTreeChildResponse {
  nodeKey: string;
  nodeLabel: string;
  subflowId: number;
  name: string;
  children: FlowTreeChildResponse[];
}

interface FlowTreeResponse {
  id: number;
  name: string;
  children: FlowTreeChildResponse[];
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
    subflowId: number | null;
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
      where: { parentFlowId: IsNull() },
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
        entryType: dto.parentFlowId ? 'subflow' : 'default',
        entryValue: null,
        currentVersionId: null,
        parentFlowId: dto.parentFlowId ?? null,
        parentNodeKey: dto.parentNodeKey ?? null,
      });
      const savedFlow = await manager.save(CallFlowEntity, flow);
      const normalizedNodes = await this.normalizeNodesForSave(manager, savedFlow, dto.nodes);

      const savedVersion = await this.createStoredVersion(
        manager,
        savedFlow.id,
        1,
        this.buildSnapshotFromPayload(normalizedNodes, dto.edges),
        dto.versionMessage,
      );

      savedFlow.currentVersionId = savedVersion.id;
      savedFlow.updatedAt = new Date();
      await manager.save(CallFlowEntity, savedFlow);

      await this.saveNodesAndEdges(manager, savedVersion.id, normalizedNodes, dto.edges);

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
      flow.parentFlowId = dto.parentFlowId ?? flow.parentFlowId ?? null;
      flow.parentNodeKey = dto.parentNodeKey ?? flow.parentNodeKey ?? null;
      flow.updatedAt = new Date();
      await manager.save(CallFlowEntity, flow);
      const normalizedNodes = await this.normalizeNodesForSave(manager, flow, dto.nodes);

      const savedVersion = await this.createStoredVersion(
        manager,
        flow.id,
        nextVersionNumber,
        this.buildSnapshotFromPayload(normalizedNodes, dto.edges),
        dto.versionMessage,
      );

      flow.currentVersionId = savedVersion.id;
      await manager.save(CallFlowEntity, flow);

      await this.saveNodesAndEdges(manager, savedVersion.id, normalizedNodes, dto.edges);

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
          subflowId: node.subflowId,
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

  async getSubflow(
    parentFlowId: number,
    parentNodeKey: string,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<CallFlowEntity | null> {
    return manager.findOne(CallFlowEntity, {
      where: { parentFlowId, parentNodeKey },
      order: { id: 'ASC' },
    });
  }

  async createSubflow(
    parentFlowId: number,
    parentNodeKey: string,
    name: string,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<number> {
    const existing = await this.getSubflow(parentFlowId, parentNodeKey, manager);
    if (existing) {
      return existing.id;
    }

    const flowName = name.trim() || `Menu ${parentNodeKey}`;
    const slug = await this.ensureUniqueSlug(
      manager.getRepository(CallFlowEntity),
      this.slugify(flowName),
    );

    const subflow = manager.create(CallFlowEntity, {
      name: flowName,
      description: null,
      slug,
      status: 'published',
      entryType: 'subflow',
      entryValue: null,
      currentVersionId: null,
      parentFlowId,
      parentNodeKey,
    });
    const savedSubflow = await manager.save(CallFlowEntity, subflow);

    const startNode: CreateFlowDto['nodes'][number] = {
      nodeKey: 'start',
      type: 'start',
      label: 'Start',
      positionX: 120,
      positionY: 140,
      config: {},
      groupId: null,
      subflowId: null,
    };
    const version = await this.createStoredVersion(
      manager,
      savedSubflow.id,
      1,
      this.buildSnapshotFromPayload([startNode], []),
      'Initialized submenu',
    );
    savedSubflow.currentVersionId = version.id;
    savedSubflow.updatedAt = new Date();
    await manager.save(CallFlowEntity, savedSubflow);
    await this.saveNodesAndEdges(manager, version.id, [startNode], []);

    return savedSubflow.id;
  }

  async getBreadcrumb(id: number): Promise<{ data: FlowBreadcrumbItemResponse[] }> {
    const breadcrumb: FlowBreadcrumbItemResponse[] = [];
    let currentId: number | null = id;

    while (currentId) {
      const flow = await this.callFlowsRepository.findOne({ where: { id: currentId } });
      if (!flow) {
        break;
      }
      breadcrumb.push({ flowId: flow.id, flowName: flow.name });
      currentId = flow.parentFlowId ?? null;
    }

    if (breadcrumb.length === 0) {
      throw new NotFoundException(`Flow ${id} not found`);
    }

    return { data: breadcrumb.reverse() };
  }

  async getFlowTree(rootFlowId: number): Promise<{ data: FlowTreeResponse }> {
    const rootFlow = await this.callFlowsRepository.findOne({ where: { id: rootFlowId } });
    if (!rootFlow) {
      throw new NotFoundException(`Flow ${rootFlowId} not found`);
    }

    return {
      data: await this.buildFlowTree(rootFlow, 0, new Set<number>()),
    };
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

  private async buildFlowTree(
    flow: CallFlowEntity,
    depth: number,
    visited: Set<number>,
  ): Promise<FlowTreeResponse> {
    if (depth >= 10 || visited.has(flow.id)) {
      return {
        id: flow.id,
        name: flow.name,
        children: [],
      };
    }

    const nextVisited = new Set(visited);
    nextVisited.add(flow.id);
    const versionId = await this.resolveFlowVersionId(flow.id);

    if (!versionId) {
      return {
        id: flow.id,
        name: flow.name,
        children: [],
      };
    }

    const menuNodes = await this.flowNodesRepository.find({
      where: { flowVersionId: versionId, type: 'menu' },
      order: { id: 'ASC' },
    });

    const children = await Promise.all(
      menuNodes
        .filter((node) => Number(node.subflowId || 0 ) > 0)
        .map(async (node) => {
          const subflowId = Number(node.subflowId || 0);
          const childFlow = await this.callFlowsRepository.findOne({ where: { id: subflowId } });
          if (!childFlow) {
            return null;
          }

          const subtree = await this.buildFlowTree(childFlow, depth + 1, nextVisited);
          return {
            nodeKey: node.nodeKey,
            nodeLabel: node.label || node.nodeKey,
            subflowId,
            name: childFlow.name,
            children: subtree.children,
          };
        }),
    );

    return {
      id: flow.id,
      name: flow.name,
      children: children.filter((child): child is FlowTreeChildResponse => child !== null),
    };
  }


  private async resolveFlowVersionId(flowId: number): Promise<number | null> {
    const flow = await this.callFlowsRepository.findOne({ where: { id: flowId } });
    if (!flow) {
      return null;
    }

    if (flow.currentVersionId) {
      return flow.currentVersionId;
    }

    const latestVersion = await this.flowVersionsRepository.findOne({
      where: { flowId },
      order: { versionNumber: 'DESC' },
    });
    return latestVersion?.id ?? null;
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
        subflowId: node.subflowId,
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
        subflowId: node.subflowId ?? null,
      })),
      edges: edges.map((edge) => ({
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey ?? 'default',
        condition: edge.condition ?? null,
      })),
    };
  }

  private async normalizeNodesForSave(
    manager: DataSource['manager'],
    flow: CallFlowEntity,
    nodes: CreateFlowDto['nodes'],
  ): Promise<CreateFlowDto['nodes']> {
    return Promise.all(nodes.map(async (node) => {
      if (node.type !== 'menu') {
        return {
          ...node,
          subflowId: node.subflowId ?? null,
        };
      }

      const existingSubflowId = node.subflowId
        ?? (await this.getSubflow(flow.id, node.nodeKey, manager))?.id
        ?? null;
      const subflowId = existingSubflowId ?? await this.createSubflow(
        flow.id,
        node.nodeKey,
        this.buildSubflowName(flow.name, node.label, node.nodeKey),
        manager,
      );

      return {
        ...node,
        subflowId,
      };
    }));
  }

  private buildSubflowName(flowName: string, label: string | undefined, nodeKey: string): string {
    const menuLabel = label?.trim() || 'Menu';
    return `${flowName} — ${menuLabel} submenu (${nodeKey})`;
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
        subflowId: node.subflowId ?? null,
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
      parentFlowId: flow.parentFlowId ?? null,
      parentNodeKey: flow.parentNodeKey ?? null,
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
        subflowId: node.subflowId ?? null,
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
