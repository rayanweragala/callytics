import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { AppLogger } from '../logger/app-logger';
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
  flowId?: number;
  name?: string;
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
  subflows?: FlowVersionSubflowSnapshot[];
}

interface FlowVersionSubflowSnapshot {
  flowId: number;
  name: string;
  nodes: FlowVersionSnapshot['nodes'];
  edges: FlowVersionSnapshot['edges'];
  subflows?: FlowVersionSubflowSnapshot[];
}

type FlowVersionNodePayload = CreateFlowDto['nodes'][number];
type FlowVersionEdgePayload = CreateFlowDto['edges'][number];

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

interface FlowNodeInput {
  nodeKey: string;
  type: string;
  config?: Record<string, unknown>;
}

const TIMEOUT_MIN_MS = 1000;
const TIMEOUT_MAX_MS = 120000;
const TIMEOUT_CAPABLE_NODE_TYPES = new Set(['get_digits', 'menu', 'transfer', 'webhook', 'queue_login', 'callback']);

function parseTimeoutMs(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < TIMEOUT_MIN_MS || numeric > TIMEOUT_MAX_MS) return null;
  return numeric;
}

function getFlowDefaultTimeoutMs(nodes: FlowNodeInput[]): number | null {
  const startNode = nodes.find((node) => node.type === 'start');
  if (!startNode) return null;
  return parseTimeoutMs(startNode.config?.flow_default_timeout_ms ?? startNode.config?.queue_login_default_input_timeout_ms);
}

function isValidExtensionTarget(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

function isValidPstnTarget(value: string): boolean {
  return /^\+?[0-9]{4,20}$/.test(value);
}

function isValidSipUriTarget(value: string): boolean {
  return /^sip:[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+$/.test(value);
}

function validateTransferTargetValue(nodeKey: string, targetType: string, targetValue: string): void {
  if (targetType === 'extension' && !isValidExtensionTarget(targetValue)) {
    throw new BadRequestException(`Node ${nodeKey}: extension target_value must contain only letters, numbers, underscores, or hyphens`);
  }
  if (targetType === 'pstn' && !isValidPstnTarget(targetValue)) {
    throw new BadRequestException(`Node ${nodeKey}: pstn target_value must be 4-20 digits with an optional leading +`);
  }
  if (targetType === 'sip_uri' && !isValidSipUriTarget(targetValue)) {
    throw new BadRequestException(`Node ${nodeKey}: sip_uri target_value must be a valid SIP URI`);
  }
}

function validateHuntTargetValue(nodeKey: string, targetType: string, targetValue: string): void {
  if (targetType === 'extension' && !isValidExtensionTarget(targetValue)) {
    throw new BadRequestException(`Node ${nodeKey}: hunt destination extension target_value must contain only letters, numbers, underscores, or hyphens`);
  }
  if (targetType === 'pstn' && !isValidPstnTarget(targetValue)) {
    throw new BadRequestException(`Node ${nodeKey}: hunt destination pstn target_value must be 4-20 digits with an optional leading +`);
  }
}

export function validateNodeConfig(node: FlowNodeInput): void {
  if (node.type === 'transfer') {
    const targetType = String(node.config?.target_type || '').trim();
    const targetValue = String(node.config?.target_value || '').trim();

    if (!['extension', 'pstn', 'sip_uri'].includes(targetType)) {
      throw new BadRequestException(`Node ${node.nodeKey}: target_type must be extension, pstn, or sip_uri`);
    }
    if (!targetValue) {
      throw new BadRequestException(`Node ${node.nodeKey}: target_value is required`);
    }
    validateTransferTargetValue(node.nodeKey, targetType, targetValue);

  }

  if (node.type === 'hunt') {
    const destinations = node.config?.destinations;
    if (!Array.isArray(destinations) || destinations.length === 0) {
      throw new BadRequestException(`Node ${node.nodeKey}: destinations must have at least one entry`);
    }
    for (const destination of destinations) {
      const entry = destination as Record<string, unknown>;
      const targetType = String(entry.target_type || '').trim();
      const targetValue = String(entry.target_value || '').trim();
      if (!['extension', 'pstn'].includes(targetType)) {
        throw new BadRequestException(`Node ${node.nodeKey}: hunt destination target_type must be extension or pstn`);
      }
      if (!targetValue) {
        throw new BadRequestException(`Node ${node.nodeKey}: hunt destination target_value is required`);
      }
      validateHuntTargetValue(node.nodeKey, targetType, targetValue);
    }
  }
  if (node.type === 'menu') {
    const promptAudioFileId = node.config?.prompt_audio_file_id;
    const audioId = typeof promptAudioFileId === 'number' ? promptAudioFileId : Number(promptAudioFileId);
    if (!Number.isInteger(audioId) || audioId <= 0) {
      throw new BadRequestException(`Node ${node.nodeKey}: prompt_audio_file_id is required`);
    }
    const branches = node.config?.branches;
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new BadRequestException(`Node ${node.nodeKey}: branches must have at least one entry`);
    }
  }
  if (node.type === 'queue_login') {
    if (!node.config?.queue_id) {
      throw new BadRequestException(`Node ${node.nodeKey}: queue is required`);
    }
  }
  if (node.type === 'queue') {
    if (!node.config?.queue_id) {
      throw new BadRequestException(`Node ${node.nodeKey}: queue is required`);
    }
  }
  if (node.type === 'conference') {
    const roomName = String(node.config?.roomName || '').trim();
    if (!roomName) {
      throw new BadRequestException(`Node ${node.nodeKey}: roomName is required`);
    }
    if (!/^[a-zA-Z0-9]+$/.test(roomName)) {
      throw new BadRequestException(`Node ${node.nodeKey}: roomName must contain only letters and numbers`);
    }
    const waitForModerator = Boolean(node.config?.waitForModerator);
    if (waitForModerator) {
      const moderatorType = node.config?.moderatorType === 'pstn' ? 'pstn' : node.config?.moderatorType === 'extension' ? 'extension' : null;
      const moderatorId = Number(node.config?.moderatorId || 0);
      if (!moderatorType) {
        throw new BadRequestException(`Node ${node.nodeKey}: moderatorType must be extension or pstn`);
      }
      if (!Number.isInteger(moderatorId) || moderatorId <= 0) {
        throw new BadRequestException(`Node ${node.nodeKey}: moderatorId is required`);
      }
    }
  }
  if (node.type === 'callback') {
    const numberSource = String(node.config?.number_source || '').trim();
    if (!['ani', 'dtmf'].includes(numberSource)) {
      throw new BadRequestException(`Node ${node.nodeKey}: number_source must be ani or dtmf`);
    }

    const confirmationAudioId = Number(node.config?.confirmation_audio_id || 0);
    if (!Number.isInteger(confirmationAudioId) || confirmationAudioId <= 0) {
      throw new BadRequestException(`Node ${node.nodeKey}: confirmation_audio_id is required`);
    }

    if (numberSource === 'dtmf') {
      const maxDigitsRaw = node.config?.dtmf_max_digits;
      const maxDigits = maxDigitsRaw === null || maxDigitsRaw === undefined || maxDigitsRaw === ''
        ? 11
        : Number(maxDigitsRaw);
      if (!Number.isInteger(maxDigits) || maxDigits < 1 || maxDigits > 20) {
        throw new BadRequestException(`Node ${node.nodeKey}: dtmf_max_digits must be between 1 and 20`);
      }
    }
  }
  if (node.type === 'webhook') {
    const url = String(node.config?.url || '').trim();
    if (!url) throw new BadRequestException('Webhook node: url is required');
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new BadRequestException('Webhook node: url must use http or https');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Webhook node: url is not a valid URL');
    }
  }
}

export function validateNodesConfig(
  nodes: FlowNodeInput[],
  options?: { isSubflow?: boolean },
): void {
  const isSubflow = options?.isSubflow === true;
  const startNode = nodes.find((node) => node.type === 'start');
  if (!startNode) {
    throw new BadRequestException('Flow requires a start node');
  }

  if (!isSubflow) {
    if (!startNode.config || typeof startNode.config !== 'object') {
      startNode.config = {};
    }
    const rawFlowDefaultTimeout = startNode.config.flow_default_timeout_ms ?? startNode.config.queue_login_default_input_timeout_ms;
    if (rawFlowDefaultTimeout === undefined || rawFlowDefaultTimeout === null || rawFlowDefaultTimeout === '') {
      startNode.config.flow_default_timeout_ms = TIMEOUT_MAX_MS;
    }

    const flowDefaultTimeoutMs = getFlowDefaultTimeoutMs(nodes);
    if (flowDefaultTimeoutMs === null) {
      throw new BadRequestException(`Start node: flow_default_timeout_ms is required and must be between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}`);
    }
  }

  for (const node of nodes) {
    validateNodeConfig(node);

    if (!TIMEOUT_CAPABLE_NODE_TYPES.has(node.type)) {
      continue;
    }

    if (node.type === 'queue_login') {
      const useFlowDefaultTimeout = node.config?.use_flow_default_timeout !== false;
      const nodeTimeoutMs = parseTimeoutMs(node.config?.input_timeout_ms);
      const hasRawTimeout = node.config?.input_timeout_ms !== undefined && node.config?.input_timeout_ms !== null && node.config?.input_timeout_ms !== '';

      if (useFlowDefaultTimeout) {
        if (hasRawTimeout && nodeTimeoutMs === null) {
          throw new BadRequestException(`Node ${node.nodeKey}: input_timeout_ms must be between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}`);
        }
      } else if (nodeTimeoutMs === null) {
        throw new BadRequestException(`Node ${node.nodeKey}: input_timeout_ms must be between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS} when not using flow default timeout`);
      }
      continue;
    }

    const rawTimeout = node.config?.timeout_ms;
    const hasRawTimeout = rawTimeout !== undefined && rawTimeout !== null && rawTimeout !== '';
    if (hasRawTimeout && parseTimeoutMs(rawTimeout) === null) {
      throw new BadRequestException(`Node ${node.nodeKey}: timeout_ms must be between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS}`);
    }
  }
}

const BRANCHING_NODE_TYPES = new Set(['get_digits', 'menu']);

export function validateEdgesConfig(
  edges: Array<{ sourceNodeKey: string; targetNodeKey: string; branchKey?: string | null; condition?: string | null }>,
  nodes: FlowNodeInput[],
): void {
  const nodeTypeMap = new Map(nodes.map((n) => [n.nodeKey, n.type]));
  for (const edge of edges) {
    const sourceType = nodeTypeMap.get(edge.sourceNodeKey);
    if (sourceType === 'webhook') {
      throw new BadRequestException('Webhook nodes cannot have outgoing edges — they are side-effect targets only.');
    }
    if (sourceType && BRANCHING_NODE_TYPES.has(sourceType)) {
      if (!edge.condition || !String(edge.condition).trim()) {
        throw new BadRequestException(
          `Edge from ${edge.sourceNodeKey} to ${edge.targetNodeKey}: condition is required for ${sourceType} source nodes`,
        );
      }
    }
  }
}


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
      where: { parentFlowId: IsNull(), isTemplate: false },
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
    const startedAt = Date.now();
    const flow = await this.callFlowsRepository.findOne({ where: { id } });
    if (!flow) {
      AppLogger.dbQuery('select', 'call_flows', startedAt);
      throw new NotFoundException(`Flow ${id} not found`);
    }

    const versionId = flow.currentVersionId;
    if (!versionId) {
      const latestVersion = await this.flowVersionsRepository.findOne({
        where: { flowId: flow.id },
        order: { versionNumber: 'DESC' },
      });
      if (!latestVersion) {
        AppLogger.dbQuery('select', 'call_flows', startedAt);
        throw new NotFoundException(`Flow ${id} has no versions`);
      }
      const detail = await this.buildFlowDetail(flow, latestVersion);
      AppLogger.dbQuery('select', 'call_flows', startedAt);
      return { data: detail };
    }

    const version = await this.flowVersionsRepository.findOne({ where: { id: versionId } });
    if (!version) {
      AppLogger.dbQuery('select', 'call_flows', startedAt);
      throw new NotFoundException(`Flow ${id} version ${versionId} not found`);
    }

    const detail = await this.buildFlowDetail(flow, version);
    AppLogger.dbQuery('select', 'call_flows', startedAt);
    return { data: detail };
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
        isTemplate: false,
        templateDescription: null,
        templateCategory: null,
      });
      const savedFlow = await manager.save(CallFlowEntity, flow);
      const normalizedNodes = await this.normalizeNodesForSave(manager, savedFlow, dto.nodes);
      validateNodesConfig(normalizedNodes, { isSubflow: Boolean(savedFlow.parentFlowId) });
      validateEdgesConfig(dto.edges, normalizedNodes);

      const initialSnapshot = await this.buildSnapshotForSave(savedFlow, normalizedNodes, dto.edges, manager);
      const savedVersion = await this.createStoredVersion(
        manager,
        savedFlow.id,
        1,
        initialSnapshot,
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

      const latestVersion = await manager.findOne(FlowVersionEntity, {
        where: { flowId: flow.id },
        order: { versionNumber: 'DESC' },
      });
      if (!latestVersion) {
        throw new NotFoundException(`Flow ${id} has no version to update`);
      }
      const versionIdToUpdate = latestVersion.id;

      flow.name = dto.name;
      flow.description = dto.description ?? null;
      flow.slug = dto.slug?.trim() || flow.slug || this.slugify(dto.name);
      flow.parentFlowId = dto.parentFlowId ?? flow.parentFlowId ?? null;
      flow.parentNodeKey = dto.parentNodeKey ?? flow.parentNodeKey ?? null;
      flow.currentVersionId = versionIdToUpdate;
      flow.updatedAt = new Date();
      await manager.save(CallFlowEntity, flow);

      const normalizedNodes = await this.normalizeNodesForSave(manager, flow, dto.nodes);
      validateNodesConfig(normalizedNodes, { isSubflow: Boolean(flow.parentFlowId) });
      validateEdgesConfig(dto.edges, normalizedNodes);

      const incomingComparable = this.buildComparableSnapshotPayload(
        this.buildSnapshotFromPayload(normalizedNodes, dto.edges),
      );
      const latestComparable = this.buildComparableSnapshotPayload(
        (latestVersion.snapshot as unknown as FlowVersionSnapshot | null) ?? this.buildSnapshotFromPayload([], []),
      );

      if (incomingComparable === latestComparable) {
        const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
        const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: versionIdToUpdate } });
        return {
          data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
        };
      }

      if (flow.parentFlowId === null) {
        const rootSnapshot = await this.buildSnapshotForSave(flow, normalizedNodes, dto.edges, manager);
        const previousRootVersion = await this.getLatestVersion(flow.id, manager);
        if (!this.snapshotsAreEqual(previousRootVersion?.snapshot as unknown as FlowVersionSnapshot | null, rootSnapshot)) {
          const nextVersionNumber = (previousRootVersion?.versionNumber ?? 0) + 1;
          const savedRootVersion = await this.createStoredVersion(manager, flow.id, nextVersionNumber, rootSnapshot, dto.versionMessage);
          await this.saveNodesAndEdges(manager, savedRootVersion.id, normalizedNodes, dto.edges);
          flow.currentVersionId = savedRootVersion.id;
          flow.updatedAt = new Date();
          await manager.save(CallFlowEntity, flow);
        }

        const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
        const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: persistedFlow.currentVersionId ?? versionIdToUpdate } });
        return {
          data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
        };
      }

      const nextSubflowVersionNumber = (latestVersion.versionNumber ?? 0) + 1;
      const subflowSnapshot = this.buildSnapshotFromPayload(normalizedNodes, dto.edges);
      const savedSubflowVersion = await this.createStoredVersion(
        manager,
        flow.id,
        nextSubflowVersionNumber,
        subflowSnapshot,
        dto.versionMessage,
      );
      await this.saveNodesAndEdges(manager, savedSubflowVersion.id, normalizedNodes, dto.edges);
      flow.currentVersionId = savedSubflowVersion.id;
      flow.updatedAt = new Date();
      await manager.save(CallFlowEntity, flow);

      const rootFlowId = await this.getRootFlowId(flow.id, manager);
      const fullSnapshot = await this.buildFullTreeSnapshot(rootFlowId, manager);
      const latestRootVersion = await this.getLatestVersion(rootFlowId, manager);
      if (!this.snapshotsAreEqual(latestRootVersion?.snapshot as unknown as FlowVersionSnapshot | null, fullSnapshot)) {
        const nextVersionNumber = (latestRootVersion?.versionNumber ?? 0) + 1;
        const rootVersion = await this.createStoredVersion(manager, rootFlowId, nextVersionNumber, fullSnapshot, dto.versionMessage);
        await this.saveNodesAndEdges(
          manager,
          rootVersion.id,
          fullSnapshot.nodes.map((node) => ({
            nodeKey: node.nodeKey,
            type: node.type,
            label: node.label ?? undefined,
            positionX: node.positionX,
            positionY: node.positionY,
            config: node.config,
            groupId: node.groupId,
            subflowId: node.subflowId,
          })),
          fullSnapshot.edges.map((edge) => ({
            sourceNodeKey: edge.sourceNodeKey,
            targetNodeKey: edge.targetNodeKey,
            branchKey: edge.branchKey,
            condition: edge.condition,
          })),
        );

        const rootFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: rootFlowId } });
        rootFlow.currentVersionId = rootVersion.id;
        rootFlow.updatedAt = new Date();
        await manager.save(CallFlowEntity, rootFlow);
      }

      const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
      const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: persistedFlow.currentVersionId ?? versionIdToUpdate } });

      return {
        data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
      };
    });
  }

  async listVersions(id: number): Promise<{ data: FlowVersionSummaryResponse[] }> {
    const rootFlowId = await this.getRootFlowId(id);
    await this.ensureFlowExists(rootFlowId);
    const versions = await this.flowVersionsRepository.find({
      where: { flowId: rootFlowId },
      order: { versionNumber: 'DESC' },
    });

    return {
      data: versions
        .filter((version) => Boolean(version.snapshot && version.nodeCount !== null))
        .map((version) => this.mapFlowVersionSummary(version)),
    };
  }

  async findVersion(id: number, versionId: number): Promise<{ data: FlowVersionDetailResponse }> {
    const rootFlowId = await this.getRootFlowId(id);
    await this.ensureFlowExists(rootFlowId);
    const version = await this.flowVersionsRepository.findOne({ where: { id: versionId, flowId: rootFlowId } });
    if (!version || !version.snapshot || version.nodeCount === null) {
      throw new NotFoundException(`Flow ${rootFlowId} version ${versionId} not found`);
    }

    return { data: this.mapFlowVersionDetail(version) };
  }

  async createVersion(id: number, message: string): Promise<{ data: FlowVersionSummaryResponse }> {
    return this.dataSource.transaction(async (manager) => {
      const rootFlowId = await this.getRootFlowId(id, manager);
      const rootFlow = await manager.findOne(CallFlowEntity, { where: { id: rootFlowId } });
      if (!rootFlow) {
        throw new NotFoundException(`Flow ${id} not found`);
      }

      const snapshot = await this.buildFullTreeSnapshot(rootFlowId, manager);
      const previousVersion = await this.getLatestVersion(rootFlowId, manager);
      if (this.snapshotsAreEqual(previousVersion?.snapshot as unknown as FlowVersionSnapshot | null, snapshot)) {
        return { data: this.mapFlowVersionSummary(previousVersion as FlowVersionEntity) };
      }

      const nextVersionNumber = (previousVersion?.versionNumber ?? 0) + 1;
      const saved = await this.createStoredVersion(manager, rootFlowId, nextVersionNumber, snapshot, message);

      rootFlow.currentVersionId = saved.id;
      rootFlow.updatedAt = new Date();
      await manager.save(CallFlowEntity, rootFlow);

      await this.saveNodesAndEdges(
        manager,
        saved.id,
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
      flow.name = snapshot.name ?? flow.name;
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

      if (snapshot.subflows && snapshot.subflows.length > 0) {
        await this.restoreSubflowSnapshots(manager, snapshot.subflows);
      }

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

  private async getLatestVersion(
    flowId: number,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<FlowVersionEntity | null> {
    return manager.findOne(FlowVersionEntity, {
      where: { flowId },
      order: { versionNumber: 'DESC' },
    });
  }

  async getRootFlowId(
    flowId: number,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<number> {
    // TODO(perf): N+1 query here. Each parent traversal step performs a separate lookup.
    // Consider a recursive CTE to resolve the root flow in one query.
    let currentFlowId: number | null = flowId;
    const seen = new Set<number>();

    while (currentFlowId !== null) {
      if (seen.has(currentFlowId)) {
        throw new BadRequestException(`Flow ${flowId} has a circular parent_flow_id chain`);
      }
      seen.add(currentFlowId);
      const flow = await manager.findOne(CallFlowEntity, { where: { id: currentFlowId } });
      if (!flow) {
        throw new NotFoundException(`Flow ${flowId} not found`);
      }
      if (flow.parentFlowId === null) {
        return flow.id;
      }
      currentFlowId = flow.parentFlowId;
    }

    throw new NotFoundException(`Flow ${flowId} not found`);
  }

  private async getFlowWithNodesEdges(
    flowId: number,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<{ flow: CallFlowEntity; nodes: FlowVersionSnapshot['nodes']; edges: FlowVersionSnapshot['edges'] }> {
    const flow = await manager.findOne(CallFlowEntity, { where: { id: flowId } });
    if (!flow) {
      throw new NotFoundException(`Flow ${flowId} not found`);
    }
    const versionId = flow.currentVersionId
      ?? (await this.getLatestVersion(flow.id, manager))?.id
      ?? null;

    if (!versionId) {
      return {
        flow,
        nodes: [],
        edges: [],
      };
    }

    const snapshot = await this.buildSnapshotFromVersionId(versionId, manager);
    return {
      flow,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
    };
  }

  private async getDirectSubflows(
    parentFlowId: number,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<CallFlowEntity[]> {
    return manager.find(CallFlowEntity, {
      where: { parentFlowId },
      order: { id: 'ASC' },
    });
  }

  private async buildFullTreeSnapshot(
    rootFlowId: number,
    manager: DataSource['manager'] = this.dataSource.manager,
    visited = new Set<number>(),
  ): Promise<FlowVersionSnapshot> {
    // TODO(perf): N+1 query here. Recursive subtree expansion loads each flow and subflow chain separately.
    // Consider batch loading subtree rows before snapshot assembly.
    if (visited.has(rootFlowId)) {
      throw new BadRequestException(`Flow ${rootFlowId} has a circular subflow tree`);
    }

    const flowData = await this.getFlowWithNodesEdges(rootFlowId, manager);
    const childFlows = await this.getDirectSubflows(rootFlowId, manager);
    const nextVisited = new Set(visited);
    nextVisited.add(rootFlowId);

    const subflows = await Promise.all(
      childFlows.map((child) => this.buildFullTreeSnapshot(child.id, manager, nextVisited)),
    );

    return {
      flowId: flowData.flow.id,
      name: flowData.flow.name,
      nodes: flowData.nodes,
      edges: flowData.edges,
      subflows: subflows.map((snapshot) => ({
        flowId: snapshot.flowId ?? 0,
        name: snapshot.name ?? `Subflow #${snapshot.flowId ?? 0}`,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        ...(snapshot.subflows && snapshot.subflows.length > 0 ? { subflows: snapshot.subflows } : {}),
      })),
    };
  }

  private snapshotsAreEqual(a: FlowVersionSnapshot | null | undefined, b: FlowVersionSnapshot | null | undefined): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return this.buildComparableSnapshotPayload(a) === this.buildComparableSnapshotPayload(b);
  }

  protected async buildFlowSnapshot(
    flow: CallFlowEntity,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<FlowVersionSnapshot> {
    const flowVersionId = flow.currentVersionId
      ?? (await manager.findOne(FlowVersionEntity, {
        where: { flowId: flow.id },
        order: { versionNumber: 'DESC' },
      }))?.id
      ?? null;
    if (!flowVersionId) {
      return this.buildSnapshotFromPayload([], []);
    }
    const snapshot = await this.buildSnapshotFromVersionId(flowVersionId, manager);
    if (flow.parentFlowId !== null) {
      return snapshot;
    }
    const subflows = await this.buildSubflowSnapshotsRecursive(flow.id, manager, new Set<number>([flow.id]));
    if (subflows.length === 0) {
      return snapshot;
    }
    return {
      ...snapshot,
      subflows,
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

  private async buildSnapshotForSave(
    flow: CallFlowEntity,
    nodes: CreateFlowDto['nodes'],
    edges: CreateFlowDto['edges'],
    manager: DataSource['manager'],
  ): Promise<FlowVersionSnapshot> {
    const base = this.buildSnapshotFromPayload(nodes, edges);
    if (flow.parentFlowId !== null) {
      return base;
    }
    const subflows = await this.buildSubflowSnapshotsRecursive(flow.id, manager, new Set<number>([flow.id]));
    return {
      flowId: flow.id,
      name: flow.name,
      ...base,
      ...(subflows.length > 0 ? { subflows } : {}),
    };
  }

  private async buildSubflowSnapshotsRecursive(
    parentFlowId: number,
    manager: DataSource['manager'],
    visited: Set<number>,
  ): Promise<FlowVersionSubflowSnapshot[]> {
    const childFlows = await manager.find(CallFlowEntity, {
      where: { parentFlowId },
      order: { id: 'ASC' },
    });
    const snapshots: FlowVersionSubflowSnapshot[] = [];
    for (const child of childFlows) {
      if (visited.has(child.id)) {
        continue;
      }
      const childVersionId = child.currentVersionId
        ?? (await manager.findOne(FlowVersionEntity, {
          where: { flowId: child.id },
          order: { versionNumber: 'DESC' },
        }))?.id
        ?? null;
      if (!childVersionId) {
        continue;
      }
      const childBaseSnapshot = await this.buildSnapshotFromVersionId(childVersionId, manager);
      const childVisited = new Set(visited);
      childVisited.add(child.id);
      const childSubflows = await this.buildSubflowSnapshotsRecursive(child.id, manager, childVisited);
      snapshots.push({
        flowId: child.id,
        name: child.name,
        nodes: childBaseSnapshot.nodes,
        edges: childBaseSnapshot.edges,
        ...(childSubflows.length > 0 ? { subflows: childSubflows } : {}),
      });
    }
    return snapshots;
  }

  private mapSnapshotNodesToPayload(nodes: FlowVersionSnapshot['nodes']): FlowVersionNodePayload[] {
    return nodes.map((node) => ({
      nodeKey: node.nodeKey,
      type: node.type,
      label: node.label ?? undefined,
      positionX: node.positionX,
      positionY: node.positionY,
      config: node.config,
      groupId: node.groupId,
      subflowId: node.subflowId,
    }));
  }

  private mapSnapshotEdgesToPayload(edges: FlowVersionSnapshot['edges']): FlowVersionEdgePayload[] {
    return edges.map((edge) => ({
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      branchKey: edge.branchKey,
      condition: edge.condition,
    }));
  }

  private async restoreSubflowSnapshots(
    manager: DataSource['manager'],
    snapshots: FlowVersionSubflowSnapshot[],
  ): Promise<void> {
    for (const snapshot of snapshots) {
      const flowId = Number(snapshot.flowId || 0);
      if (flowId <= 0) {
        continue;
      }

      const subflow = await manager.findOne(CallFlowEntity, { where: { id: flowId } });
      if (!subflow) {
        throw new NotFoundException(`Flow ${flowId} not found`);
      }

      const previousVersion = await this.getLatestVersion(flowId, manager);
      const nextVersionNumber = (previousVersion?.versionNumber ?? 0) + 1;
      const nextSnapshot: FlowVersionSnapshot = {
        flowId,
        name: snapshot.name,
        nodes: snapshot.nodes,
        edges: snapshot.edges,
      };
      const savedVersion = await this.createStoredVersion(
        manager,
        flowId,
        nextVersionNumber,
        nextSnapshot,
        `Restored from root version`,
      );
      await this.saveNodesAndEdges(
        manager,
        savedVersion.id,
        this.mapSnapshotNodesToPayload(snapshot.nodes),
        this.mapSnapshotEdgesToPayload(snapshot.edges),
      );

      subflow.currentVersionId = savedVersion.id;
      subflow.name = snapshot.name ?? subflow.name;
      subflow.updatedAt = new Date();
      await manager.save(CallFlowEntity, subflow);

      if (snapshot.subflows && snapshot.subflows.length > 0) {
        await this.restoreSubflowSnapshots(manager, snapshot.subflows);
      }
    }
  }

  private async buildSnapshotFromVersionId(
    flowVersionId: number,
    manager: DataSource['manager'],
  ): Promise<FlowVersionSnapshot> {
    const nodes = await manager.find(FlowNodeEntity, {
      where: { flowVersionId },
      order: { id: 'ASC' },
    });
    const edges = await manager.find(FlowEdgeEntity, {
      where: { flowVersionId },
      order: { id: 'ASC' },
    });
    return {
      nodes: nodes.map((node) => ({
        nodeKey: node.nodeKey,
        type: node.type,
        label: node.label,
        positionX: node.positionX,
        positionY: node.positionY,
        config: node.configJson ?? {},
        groupId: node.groupId ?? null,
        subflowId: node.subflowId ?? null,
      })),
      edges: edges.map((edge) => ({
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey,
        condition: edge.condition ?? null,
      })),
    };
  }

  private buildComparableSnapshotPayload(snapshot: FlowVersionSnapshot): string {
    const normalize = (input: FlowVersionSnapshot | FlowVersionSubflowSnapshot) => {
      const sortedNodes = [...(input.nodes ?? [])]
        .map((node) => ({
          nodeKey: String(node.nodeKey),
          type: String(node.type),
          label: node.label ?? null,
          positionX: Number(node.positionX ?? 0),
          positionY: Number(node.positionY ?? 0),
          config: node.config ?? {},
          groupId: node.groupId ?? null,
          subflowId: node.subflowId ?? null,
        }))
        .sort((a, b) => a.nodeKey.localeCompare(b.nodeKey));

      const sortedEdges = [...(input.edges ?? [])]
        .map((edge) => ({
          sourceNodeKey: String(edge.sourceNodeKey),
          targetNodeKey: String(edge.targetNodeKey),
          branchKey: edge.branchKey ?? 'default',
          condition: edge.condition ?? null,
        }))
        .sort((a, b) => {
          const source = a.sourceNodeKey.localeCompare(b.sourceNodeKey);
          if (source !== 0) return source;
          const target = a.targetNodeKey.localeCompare(b.targetNodeKey);
          if (target !== 0) return target;
          return `${a.condition ?? ''}`.localeCompare(`${b.condition ?? ''}`);
        });

      const sortedSubflows = [...(input.subflows ?? [])]
        .sort((a, b) => a.flowId - b.flowId)
        .map((subflow) => normalize(subflow));

      return {
        flowId: 'flowId' in input ? Number(input.flowId ?? 0) : 0,
        name: 'name' in input ? (input.name ?? null) : null,
        nodes: sortedNodes,
        edges: sortedEdges,
        subflows: sortedSubflows,
      };
    };

    return JSON.stringify(normalize(snapshot));
  }

  protected async normalizeNodesForSave(
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

  protected async createStoredVersion(
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

  protected mapFlowVersionSummary(version: FlowVersionEntity): FlowVersionSummaryResponse {
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

  protected async saveNodesAndEdges(
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

  protected async buildFlowDetail(
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
