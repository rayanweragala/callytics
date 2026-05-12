import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
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

interface FlowRenameResponse {
  id: number;
  name: string;
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
  sourceHandle: string | null;
  targetHandle: string | null;
}

interface FlowDetailResponse {
  id: number;
  name: string;
  description: string | null;
  slug: string;
  parentFlowId: number | null;
  parentNodeKey: string | null;
  parentBranchKey: string | null;
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
  parentNodeKey: string | null;
  parentNodeLabel: string | null;
  parentBranchKey: string | null;
}

interface FlowTreeChildResponse {
  nodeKey: string;
  nodeLabel: string;
  branchKey: string | null;
  subflowId: number;
  name: string;
  children: FlowTreeChildResponse[];
}

interface MenuBranchSubflowResponse {
  flowId: number;
  name: string;
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
    sourceHandle: string | null;
    targetHandle: string | null;
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
const TERMINAL_NODE_TYPES = new Set(['hangup', 'transfer', 'voicemail', 'callback', 'queue_login']);
const START_ALLOWED_TARGET_TYPES = new Set(['play_audio', 'menu', 'business_hours', 'transfer', 'hunt', 'queue', 'queue_login', 'hangup', 'conference', 'webhook', 'callback', 'voicemail']);
const GET_DIGITS_ALLOWED_SOURCE_TYPES = new Set(['start', 'play_audio', 'menu', 'business_hours', 'webhook']);
const QUEUE_LOGIN_ALLOWED_SOURCE_TYPES = new Set(['start', 'menu', 'play_audio', 'get_digits']);
const VOICEMAIL_BLOCKED_SOURCE_TYPES = new Set(['queue_login', 'hunt', 'transfer', 'queue']);
const IMMEDIATE_HANGUP_PUBLISH_MESSAGE =
  'This flow hangs up immediately on every caller. Add at least one action node between Start and Hangup before publishing.';

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

function isPositiveId(value: unknown): boolean {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0;
}

function isValidDigitConditionValue(value: string): boolean {
  return /^(?:\d{1,2}|\*|#|timeout|invalid|default)$/.test(value.trim());
}

function isValidMenuBranchValue(value: string): boolean {
  return /^(?:\d{1,2}|\*|#)$/.test(value.trim());
}

function sanitizeMenuBranches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['1', '2'];
  }

  const branches = value
    .map((item) => String(item || '').trim())
    .filter((item) => isValidMenuBranchValue(item));

  return branches.length > 0 ? Array.from(new Set(branches)) : ['1', '2'];
}

function sanitizeMenuBranchNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([branch, label]) => [String(branch || '').trim(), String(label || '').trim()] as const)
    .filter(([branch, label]) => isValidMenuBranchValue(branch) && Boolean(label));

  return Object.fromEntries(entries);
}

function sanitizePersistedNodeConfig(type: string, config: Record<string, unknown> | undefined): Record<string, unknown> {
  const nextConfig = { ...(config ?? {}) };
  if (type === 'voicemail') {
    delete nextConfig.webhook_url;
    delete nextConfig.webhook_secret;
    return nextConfig;
  }
  if (type !== 'menu') {
    return nextConfig;
  }

  delete nextConfig.submenu_branch_flows;
  nextConfig.submenu_branch_names = sanitizeMenuBranchNames(nextConfig.submenu_branch_names);
  return nextConfig;
}

function isImmediateHangupSnapshot(snapshot: FlowVersionSnapshot): boolean {
  if (snapshot.nodes.length !== 2 || snapshot.edges.length !== 1) {
    return false;
  }
  const startNode = snapshot.nodes.find((node) => node.type === 'start');
  const hangupNode = snapshot.nodes.find((node) => node.type === 'hangup');
  if (!startNode || !hangupNode) {
    return false;
  }
  return (
    snapshot.edges[0].sourceNodeKey === startNode.nodeKey &&
    snapshot.edges[0].targetNodeKey === hangupNode.nodeKey
  );
}

export function validateNodeConfig(node: FlowNodeInput): void {
  if (node.type === 'play_audio' && !isPositiveId(node.config?.audio_file_id)) {
    throw new BadRequestException(`Node ${node.nodeKey}: audio_file_id is required`);
  }
  if (node.type === 'get_digits') {
    if (!String(node.config?.variable_name || '').trim()) {
      throw new BadRequestException(`Node ${node.nodeKey}: variable_name is required`);
    }
    if (node.config?.timeout_ms === undefined || node.config?.timeout_ms === null || node.config?.timeout_ms === '') {
      throw new BadRequestException(`Node ${node.nodeKey}: timeout_ms is required`);
    }
  }
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
    for (const branch of branches) {
      if (!isValidMenuBranchValue(String(branch || ''))) {
        throw new BadRequestException(`Node ${node.nodeKey}: branch keys must be 1-2 digits, *, or #`);
      }
    }
  }
  if (node.type === 'queue_login') {
    const queueIdsRaw = Array.isArray(node.config?.queue_ids)
      ? node.config?.queue_ids
      : (isPositiveId(node.config?.queue_id) ? [node.config?.queue_id] : []);
    const queueIds = queueIdsRaw
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (queueIds.length === 0) {
      throw new BadRequestException(`Node ${node.nodeKey}: at least one queue is required`);
    }
    if (queueIds.length !== queueIdsRaw.length) {
      throw new BadRequestException(`Node ${node.nodeKey}: queue_ids must contain only positive integer IDs`);
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
    if (!String(node.config?.destination_value || '').trim()) {
      throw new BadRequestException(`Node ${node.nodeKey}: destination_value is required`);
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
  if (node.type === 'voicemail') {
    if (!isPositiveId(node.config?.start_audio_id)) {
      throw new BadRequestException(`Node ${node.nodeKey}: start_audio_id is required`);
    }
  }
  if (node.type === 'business_hours') {
    const schedule = node.config?.schedule;
    const hasEnabledSchedule = schedule && typeof schedule === 'object' && !Array.isArray(schedule)
      && Object.values(schedule as Record<string, unknown>).some((entry) => Boolean((entry as Record<string, unknown>)?.enabled));
    if (!hasEnabledSchedule) {
      throw new BadRequestException(`Node ${node.nodeKey}: at least one enabled schedule is required`);
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

function isWebhookTargetType(targetType: string): boolean {
  return targetType === 'webhook';
}

export function validateEdgesConfig(
  edges: Array<{ sourceNodeKey: string; targetNodeKey: string; branchKey?: string | null; condition?: string | null }>,
  nodes: FlowNodeInput[],
): void {
  const nodeTypeMap = new Map(nodes.map((n) => [n.nodeKey, n.type]));
  for (const edge of edges) {
    const sourceType = nodeTypeMap.get(edge.sourceNodeKey);
    const targetType = nodeTypeMap.get(edge.targetNodeKey);
    if (!sourceType || !targetType) {
      throw new BadRequestException(`Edge from ${edge.sourceNodeKey} to ${edge.targetNodeKey}: nodes must exist`);
    }
    if (isWebhookTargetType(targetType)) {
      continue;
    }
    if (TERMINAL_NODE_TYPES.has(sourceType)) {
      throw new BadRequestException(`Edge from ${edge.sourceNodeKey}: ${sourceType} nodes cannot have outgoing edges`);
    }
    if (sourceType === 'start' && !START_ALLOWED_TARGET_TYPES.has(targetType)) {
      throw new BadRequestException(`Edge from ${edge.sourceNodeKey} to ${edge.targetNodeKey}: start cannot connect to ${targetType}`);
    }
    if (targetType === 'get_digits' && !GET_DIGITS_ALLOWED_SOURCE_TYPES.has(sourceType)) {
      throw new BadRequestException(`Edge to ${edge.targetNodeKey}: get_digits can only receive from start, play_audio, menu, business_hours, or webhook`);
    }
    if (targetType === 'queue_login' && !QUEUE_LOGIN_ALLOWED_SOURCE_TYPES.has(sourceType)) {
      throw new BadRequestException(`Edge to ${edge.targetNodeKey}: queue_login can only receive from start, menu, play_audio, or get_digits`);
    }
    if (targetType === 'voicemail' && VOICEMAIL_BLOCKED_SOURCE_TYPES.has(sourceType)) {
      throw new BadRequestException(`Edge to ${edge.targetNodeKey}: voicemail cannot receive from ${sourceType}`);
    }
    if (sourceType && BRANCHING_NODE_TYPES.has(sourceType)) {
      if (!edge.condition || !String(edge.condition).trim()) {
        throw new BadRequestException(
          `Edge from ${edge.sourceNodeKey} to ${edge.targetNodeKey}: condition is required for ${sourceType} source nodes`,
        );
      }
      if (sourceType === 'menu' && String(edge.condition) !== 'complete' && !isValidMenuBranchValue(String(edge.condition))) {
        throw new BadRequestException(`Edge from ${edge.sourceNodeKey} to ${edge.targetNodeKey}: menu conditions must be 1-2 digits, *, or #`);
      }
      if (sourceType === 'get_digits' && !isValidDigitConditionValue(String(edge.condition))) {
        throw new BadRequestException(`Edge from ${edge.sourceNodeKey} to ${edge.targetNodeKey}: get_digits conditions must be 1-2 digits, *, #, timeout, invalid, or default`);
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
    await this.dataSource.query(
      `ALTER TABLE flow_edges ADD COLUMN IF NOT EXISTS source_handle VARCHAR(100)`
    );
    await this.dataSource.query(
      `ALTER TABLE flow_edges ADD COLUMN IF NOT EXISTS target_handle VARCHAR(100)`
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
      order: { createdAt: 'DESC' },
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
      const normalizedParentBranchKey = await this.normalizeParentBranchKeyForPersist(
        manager,
        dto.parentFlowId ?? null,
        dto.parentNodeKey ?? null,
        dto.parentBranchKey ?? null,
      );

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
        parentBranchKey: normalizedParentBranchKey,
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
      const requestedParentFlowId = dto.parentFlowId ?? flow.parentFlowId ?? null;
      const requestedParentNodeKey = dto.parentNodeKey ?? flow.parentNodeKey ?? null;
      flow.parentBranchKey = await this.normalizeParentBranchKeyForPersist(
        manager,
        requestedParentFlowId,
        requestedParentNodeKey,
        dto.parentBranchKey ?? flow.parentBranchKey ?? null,
      );
      flow.currentVersionId = versionIdToUpdate;

      const normalizedNodes = await this.normalizeNodesForSave(manager, flow, dto.nodes);
      validateNodesConfig(normalizedNodes, { isSubflow: Boolean(flow.parentFlowId) });
      validateEdgesConfig(dto.edges, normalizedNodes);

      const nextSnapshot = flow.parentFlowId === null
        ? await this.buildSnapshotForSave(flow, normalizedNodes, dto.edges, manager)
        : this.buildSnapshotFromPayload(normalizedNodes, dto.edges);
      const previousSnapshot =
        (latestVersion.snapshot as unknown as FlowVersionSnapshot | null) ?? this.buildSnapshotFromPayload([], []);

      if (this.snapshotsAreExactlyEqual(previousSnapshot, nextSnapshot)) {
        const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
        const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: versionIdToUpdate } });
        return {
          data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
        };
      }

      flow.updatedAt = new Date();
      await manager.save(CallFlowEntity, flow);

      if (dto.autoSave) {
        await this.replaceVersionSnapshot(
          manager,
          latestVersion,
          nextSnapshot,
          normalizedNodes,
          dto.edges,
        );

        if (flow.parentFlowId !== null) {
          const rootFlowId = await this.getRootFlowId(flow.id, manager);
          const rootFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: rootFlowId } });
          const rootVersionId = rootFlow.currentVersionId ?? (await this.getLatestVersion(rootFlowId, manager))?.id;
          if (rootVersionId) {
            const fullSnapshot = await this.buildFullTreeSnapshot(rootFlowId, manager);
            const rootVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: rootVersionId } });
            
            if (!this.snapshotsAreExactlyEqual(rootVersion.snapshot as unknown as FlowVersionSnapshot, fullSnapshot)) {
              await this.replaceVersionSnapshot(
                manager,
                rootVersion,
                fullSnapshot,
                this.mapSnapshotNodesToPayload(fullSnapshot.nodes),
                this.mapSnapshotEdgesToPayload(fullSnapshot.edges),
              );
            }
          }
        }

        const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
        const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: versionIdToUpdate } });
        return {
          data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
        };
      }

      if (flow.parentFlowId === null) {
        const previousRootVersion = await this.getLatestVersion(flow.id, manager);
        const previousRootSnapshot =
          (previousRootVersion?.snapshot as unknown as FlowVersionSnapshot | null) ?? this.buildSnapshotFromPayload([], []);

        if (this.snapshotsAreStructurallyEqual(previousRootSnapshot, nextSnapshot)) {
          await this.replaceVersionSnapshot(
            manager,
            latestVersion,
            nextSnapshot,
            normalizedNodes,
            dto.edges,
          );
        } else if (!this.snapshotsAreExactlyEqual(previousRootSnapshot, nextSnapshot)) {
          const nextVersionNumber = (previousRootVersion?.versionNumber ?? 0) + 1;
          const savedRootVersion = await this.createStoredVersion(manager, flow.id, nextVersionNumber, nextSnapshot, dto.versionMessage);
          await this.saveNodesAndEdges(manager, savedRootVersion.id, normalizedNodes, dto.edges);
          flow.currentVersionId = savedRootVersion.id;
          await manager.save(CallFlowEntity, flow);
        }

        const persistedFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: flow.id } });
        const persistedVersion = await manager.findOneOrFail(FlowVersionEntity, { where: { id: persistedFlow.currentVersionId ?? versionIdToUpdate } });
        return {
          data: await this.buildFlowDetail(persistedFlow, persistedVersion, manager),
        };
      }

      if (this.snapshotsAreStructurallyEqual(previousSnapshot, nextSnapshot)) {
        await this.replaceVersionSnapshot(
          manager,
          latestVersion,
          nextSnapshot,
          normalizedNodes,
          dto.edges,
        );
      } else {
        const nextSubflowVersionNumber = (latestVersion.versionNumber ?? 0) + 1;
        const savedSubflowVersion = await this.createStoredVersion(
          manager,
          flow.id,
          nextSubflowVersionNumber,
          nextSnapshot,
          dto.versionMessage,
        );
        await this.saveNodesAndEdges(manager, savedSubflowVersion.id, normalizedNodes, dto.edges);
        flow.currentVersionId = savedSubflowVersion.id;
        await manager.save(CallFlowEntity, flow);
      }

      const rootFlowId = await this.getRootFlowId(flow.id, manager);
      const fullSnapshot = await this.buildFullTreeSnapshot(rootFlowId, manager);
      const latestRootVersion = await this.getLatestVersion(rootFlowId, manager);
      const previousRootSnapshot =
        (latestRootVersion?.snapshot as unknown as FlowVersionSnapshot | null) ?? this.buildSnapshotFromPayload([], []);
      if (this.snapshotsAreStructurallyEqual(previousRootSnapshot, fullSnapshot)) {
        if (latestRootVersion) {
          if (!this.snapshotsAreExactlyEqual(previousRootSnapshot, fullSnapshot)) {
            await this.replaceVersionSnapshot(
              manager,
              latestRootVersion,
              fullSnapshot,
              this.mapSnapshotNodesToPayload(fullSnapshot.nodes),
              this.mapSnapshotEdgesToPayload(fullSnapshot.edges),
            );
          }
        }
      } else if (!this.snapshotsAreExactlyEqual(previousRootSnapshot, fullSnapshot)) {
        const nextVersionNumber = (latestRootVersion?.versionNumber ?? 0) + 1;
        const rootVersion = await this.createStoredVersion(manager, rootFlowId, nextVersionNumber, fullSnapshot, dto.versionMessage);
        await this.saveNodesAndEdges(
          manager,
          rootVersion.id,
          this.mapSnapshotNodesToPayload(fullSnapshot.nodes),
          this.mapSnapshotEdgesToPayload(fullSnapshot.edges),
        );

        const rootFlow = await manager.findOneOrFail(CallFlowEntity, { where: { id: rootFlowId } });
        rootFlow.currentVersionId = rootVersion.id;
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
      if (isImmediateHangupSnapshot(snapshot)) {
        throw new BadRequestException(IMMEDIATE_HANGUP_PUBLISH_MESSAGE);
      }
      const previousVersion = await this.getLatestVersion(rootFlowId, manager);
      if (this.snapshotsAreStructurallyEqual(previousVersion?.snapshot as unknown as FlowVersionSnapshot | null, snapshot)) {
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
        this.mapSnapshotNodesToPayload(snapshot.nodes),
        this.mapSnapshotEdgesToPayload(snapshot.edges),
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
    parentBranchKey: string | null = null,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<CallFlowEntity | null> {
    return manager.findOne(CallFlowEntity, {
      where: { parentFlowId, parentNodeKey, parentBranchKey },
      order: { id: 'ASC' },
    });
  }

  async createSubflow(
    parentFlowId: number,
    parentNodeKey: string,
    parentBranchKey: string | null,
    name: string,
    manager: DataSource['manager'] = this.dataSource.manager,
  ): Promise<number> {
    const normalizedParentBranchKey = await this.normalizeParentBranchKeyForPersist(
      manager,
      parentFlowId,
      parentNodeKey,
      parentBranchKey,
    );
    const existing = await this.getSubflow(parentFlowId, parentNodeKey, normalizedParentBranchKey, manager);
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
      parentBranchKey: normalizedParentBranchKey,
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
      const parentNodeLabel = flow.parentFlowId && flow.parentNodeKey
        ? await this.resolveParentNodeLabel(flow.parentFlowId, flow.parentNodeKey)
        : null;
      breadcrumb.push({
        flowId: flow.id,
        flowName: flow.name,
        parentNodeKey: flow.parentNodeKey ?? null,
        parentNodeLabel,
        parentBranchKey: flow.parentBranchKey ?? null,
      });
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

  async rename(id: number, name: string | undefined): Promise<{ data: FlowRenameResponse }> {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      throw new BadRequestException('Flow name is required');
    }

    const flow = await this.callFlowsRepository.findOne({ where: { id } });
    if (!flow) {
      throw new NotFoundException(`Flow ${id} not found`);
    }

    flow.name = trimmedName;
    flow.updatedAt = new Date();
    const saved = await this.callFlowsRepository.save(flow);

    return {
      data: {
        id: saved.id,
        name: saved.name,
      },
    };
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    return this.dataSource.transaction(async (manager) => {
      const flow = await manager.findOne(CallFlowEntity, { where: { id } });
      if (!flow) {
        throw new NotFoundException(`Flow ${id} not found`);
      }

      const flowsToDelete = await this.collectFlowSubtreeForDelete(flow, manager);
      const flowIds = flowsToDelete.map((item) => item.id);
      const versions = await manager.find(FlowVersionEntity, { where: { flowId: In(flowIds) } });
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

      await manager
        .createQueryBuilder()
        .delete()
        .from(CallFlowEntity)
        .where('id IN (:...flowIds)', { flowIds })
        .execute();
      return { data: { id: flow.id, deleted: true as const } };
    });
  }

  private async collectFlowSubtreeForDelete(
    root: CallFlowEntity,
    manager: DataSource['manager'],
  ): Promise<CallFlowEntity[]> {
    const ordered: CallFlowEntity[] = [];
    const queue: CallFlowEntity[] = [root];
    const visited = new Set<number>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);
      ordered.push(current);

      const children = await manager.find(CallFlowEntity, {
        where: { parentFlowId: current.id },
        order: { id: 'ASC' },
      });
      queue.push(...children.filter((child) => !visited.has(child.id)));
    }

    return ordered.reverse();
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
    const childFlows = await this.callFlowsRepository.find({
      where: { parentFlowId: flow.id },
      order: { id: 'ASC' },
    });

    const children: FlowTreeChildResponse[] = [];

    for (const node of menuNodes) {
      const branchEntries = this.buildMenuBranchFlowEntries(node, childFlows);
      for (const [branchKey, childFlow] of branchEntries) {
        const subtree = await this.buildFlowTree(childFlow, depth + 1, nextVisited);
        children.push({
          nodeKey: node.nodeKey,
          nodeLabel: node.label || node.nodeKey,
          branchKey,
          subflowId: childFlow.id,
          name: childFlow.name,
          children: subtree.children,
        });
      }
    }

    return {
      id: flow.id,
      name: flow.name,
      children,
    };
  }

  private async resolveParentNodeLabel(
    parentFlowId: number,
    parentNodeKey: string,
  ): Promise<string | null> {
    const versionId = await this.resolveFlowVersionId(parentFlowId);
    if (!versionId) {
      return null;
    }

    const node = await this.flowNodesRepository.findOne({
      where: { flowVersionId: versionId, nodeKey: parentNodeKey },
    });
    return node?.label || node?.nodeKey || null;
  }

  private buildMenuBranchFlowEntries(
    node: Pick<FlowNodeEntity, 'nodeKey' | 'label' | 'subflowId' | 'configJson'>,
    childFlows: CallFlowEntity[],
  ): Array<[string, CallFlowEntity]> {
    const nodeChildFlows = childFlows.filter((child) => child.parentNodeKey === node.nodeKey);
    const configuredBranches = sanitizeMenuBranches(node.configJson?.branches);
    const branchOrder = [...configuredBranches];
    const branchFlowMap = new Map<string, CallFlowEntity>();

    for (const childFlow of nodeChildFlows) {
      const branchKey = String(childFlow.parentBranchKey || '').trim();
      if (!isValidMenuBranchValue(branchKey) || branchFlowMap.has(branchKey)) {
        continue;
      }
      branchFlowMap.set(branchKey, childFlow);
      if (!branchOrder.includes(branchKey)) {
        branchOrder.push(branchKey);
      }
    }

    const legacyFlow = nodeChildFlows.find((child) => child.id === Number(node.subflowId || 0))
      ?? nodeChildFlows.find((child) => child.parentBranchKey === null);
    const legacyBranchKey = this.resolveLegacyMenuBranchKey(node.configJson);
    if (legacyFlow && legacyBranchKey && !branchFlowMap.has(legacyBranchKey)) {
      branchFlowMap.set(legacyBranchKey, legacyFlow);
      if (!branchOrder.includes(legacyBranchKey)) {
        branchOrder.unshift(legacyBranchKey);
      }
    }

    return branchOrder
      .map((branchKey) => {
        const childFlow = branchFlowMap.get(branchKey) || null;
        return childFlow ? [branchKey, childFlow] as [string, CallFlowEntity] : null;
      })
      .filter((entry): entry is [string, CallFlowEntity] => entry !== null);
  }

  private resolveLegacyMenuBranchKey(config: Record<string, unknown> | null | undefined): string | null {
    const branches = sanitizeMenuBranches(config?.branches);
    if (branches.includes('1')) {
      return '1';
    }
    return branches[0] ?? null;
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

  private snapshotsAreExactlyEqual(a: FlowVersionSnapshot | null | undefined, b: FlowVersionSnapshot | null | undefined): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return this.buildComparableSnapshotPayload(a) === this.buildComparableSnapshotPayload(b);
  }

  private snapshotsAreStructurallyEqual(a: FlowVersionSnapshot | null | undefined, b: FlowVersionSnapshot | null | undefined): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return this.buildComparableSnapshotPayload(a, { ignoreLayoutOnly: true }) === this.buildComparableSnapshotPayload(b, { ignoreLayoutOnly: true });
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
        config: sanitizePersistedNodeConfig(node.type, node.config),
        groupId: node.groupId ?? null,
        subflowId: node.subflowId ?? null,
      })),
      edges: edges.map((edge) => ({
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey ?? 'default',
        condition: edge.condition ?? null,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
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
      config: sanitizePersistedNodeConfig(node.type, node.config),
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
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
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
        config: sanitizePersistedNodeConfig(node.type, node.configJson),
        groupId: node.groupId ?? null,
        subflowId: node.subflowId ?? null,
      })),
      edges: edges.map((edge) => ({
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey,
        condition: edge.condition ?? null,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
    };
  }

  private buildComparableSnapshotPayload(
    snapshot: FlowVersionSnapshot,
    options?: { ignoreLayoutOnly?: boolean },
  ): string {
    const ignoreLayoutOnly = options?.ignoreLayoutOnly === true;

    const sortKeys = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(sortKeys);
      const sorted: any = {};
      Object.keys(obj)
        .sort()
        .forEach((key) => {
          sorted[key] = sortKeys(obj[key]);
        });
      return sorted;
    };

    const normalize = (input: FlowVersionSnapshot | FlowVersionSubflowSnapshot) => {
      const sortedNodes = [...(input.nodes ?? [])]
        .filter((node) => !(ignoreLayoutOnly && node.type === 'group'))
        .map((node) => ({
          nodeKey: String(node.nodeKey),
          type: String(node.type),
          label: node.label ?? null,
          positionX: ignoreLayoutOnly ? 0 : Number(node.positionX ?? 0),
          positionY: ignoreLayoutOnly ? 0 : Number(node.positionY ?? 0),
          config: sortKeys(
            ignoreLayoutOnly ? sanitizePersistedNodeConfig(node.type, node.config) : (node.config ?? {}),
          ),
          groupId: ignoreLayoutOnly ? null : (node.groupId ?? null),
          subflowId: node.subflowId ?? null,
        }))
        .sort((a, b) => a.nodeKey.localeCompare(b.nodeKey));

      const sortedEdges = [...(input.edges ?? [])]
        .map((edge) => ({
          sourceNodeKey: String(edge.sourceNodeKey),
          targetNodeKey: String(edge.targetNodeKey),
          branchKey: edge.branchKey ?? 'default',
          condition: edge.condition ?? null,
          sourceHandle: edge.sourceHandle ?? null,
          targetHandle: edge.targetHandle ?? null,
        }))
        .sort((a, b) => {
          const source = a.sourceNodeKey.localeCompare(b.sourceNodeKey);
          if (source !== 0) return source;
          const target = a.targetNodeKey.localeCompare(b.targetNodeKey);
          if (target !== 0) return target;
          const condition = `${a.condition ?? ''}`.localeCompare(`${b.condition ?? ''}`);
          if (condition !== 0) return condition;
          const sourceHandle = `${a.sourceHandle ?? ''}`.localeCompare(`${b.sourceHandle ?? ''}`);
          if (sourceHandle !== 0) return sourceHandle;
          return `${a.targetHandle ?? ''}`.localeCompare(`${b.targetHandle ?? ''}`);
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
    _manager: DataSource['manager'],
    _flow: CallFlowEntity,
    nodes: CreateFlowDto['nodes'],
  ): Promise<CreateFlowDto['nodes']> {
    return nodes.map((node) => ({
      ...node,
      config: sanitizePersistedNodeConfig(node.type, node.config),
      subflowId: node.subflowId ?? null,
    }));
  }

  private resolveSubflowName(flowName: string, node: CreateFlowDto['nodes'][number]): string {
    const customName = String(node.config?.submenu_name || '').trim();
    if (customName) {
      return customName;
    }
    return this.buildSubflowName(flowName, node.label, node.nodeKey);
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

  private async replaceVersionSnapshot(
    manager: DataSource['manager'],
    version: FlowVersionEntity,
    snapshot: FlowVersionSnapshot,
    nodes: CreateFlowDto['nodes'],
    edges: CreateFlowDto['edges'],
  ): Promise<void> {
    version.snapshot = snapshot as unknown as Record<string, unknown>;
    version.nodeCount = snapshot.nodes.length;
    await manager.save(FlowVersionEntity, version);
    await this.replaceNodesAndEdges(manager, version.id, nodes, edges);
  }

  private async replaceNodesAndEdges(
    manager: DataSource['manager'],
    versionId: number,
    nodes: CreateFlowDto['nodes'],
    edges: CreateFlowDto['edges'],
  ): Promise<void> {
    await manager.createQueryBuilder().delete().from(FlowEdgeEntity).where('flow_version_id = :versionId', { versionId }).execute();
    await manager.createQueryBuilder().delete().from(FlowNodeEntity).where('flow_version_id = :versionId', { versionId }).execute();
    await this.saveNodesAndEdges(manager, versionId, nodes, edges);
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
        configJson: sanitizePersistedNodeConfig(node.type, node.config),
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
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
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
    await this.normalizeLegacyMenuBranchLinks(manager, flow, nodes);
    const branchSubflowLookup = await this.buildMenuBranchSubflowLookup(flow, nodes, manager);

    return {
      id: flow.id,
      name: flow.name,
      description: flow.description,
      slug: flow.slug,
      parentFlowId: flow.parentFlowId ?? null,
      parentNodeKey: flow.parentNodeKey ?? null,
      parentBranchKey: flow.parentBranchKey ?? null,
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
        config: node.type === 'menu'
          ? {
              ...sanitizePersistedNodeConfig(node.type, node.configJson),
              submenu_branch_flows: branchSubflowLookup.get(node.nodeKey) ?? {},
            }
          : sanitizePersistedNodeConfig(node.type, node.configJson),
        groupId: node.groupId ?? null,
        subflowId: node.subflowId ?? null,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        sourceNodeKey: edge.sourceNodeKey,
        targetNodeKey: edge.targetNodeKey,
        branchKey: edge.branchKey,
        condition: edge.condition ?? null,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })),
    };
  }

  private async buildMenuBranchSubflowLookup(
    flow: CallFlowEntity,
    nodes: FlowNodeEntity[],
    manager: DataSource['manager'],
  ): Promise<Map<string, Record<string, MenuBranchSubflowResponse>>> {
    const lookup = new Map<string, Record<string, MenuBranchSubflowResponse>>();
    if (nodes.every((node) => node.type !== 'menu')) {
      return lookup;
    }

    const childFlows = await manager.find(CallFlowEntity, {
      where: { parentFlowId: flow.id },
      order: { id: 'ASC' },
    });

    for (const node of nodes) {
      if (node.type !== 'menu') {
        continue;
      }

      const branchMap: Record<string, MenuBranchSubflowResponse> = {};
      for (const [branchKey, childFlow] of this.buildMenuBranchFlowEntries(node, childFlows)) {
        branchMap[branchKey] = {
          flowId: childFlow.id,
          name: childFlow.name,
        };
      }

      lookup.set(node.nodeKey, branchMap);
    }

    return lookup;
  }

  private async normalizeParentBranchKeyForPersist(
    manager: DataSource['manager'],
    parentFlowId: number | null,
    parentNodeKey: string | null,
    parentBranchKey: string | null,
  ): Promise<string | null> {
    const explicit = String(parentBranchKey || '').trim();
    if (explicit.length > 0) {
      return explicit;
    }
    if (!parentFlowId || !parentNodeKey) {
      return null;
    }

    const parentFlow = await manager.findOne(CallFlowEntity, { where: { id: parentFlowId } });
    const parentVersionId = parentFlow?.currentVersionId ?? null;
    if (!parentVersionId) {
      return null;
    }

    const parentNode = await manager.findOne(FlowNodeEntity, {
      where: { flowVersionId: parentVersionId, nodeKey: parentNodeKey },
    });
    if (!parentNode || parentNode.type !== 'menu') {
      return null;
    }

    return this.resolveLegacyMenuBranchKey(parentNode.configJson);
  }

  private async normalizeLegacyMenuBranchLinks(
    manager: DataSource['manager'],
    flow: CallFlowEntity,
    nodes: FlowNodeEntity[],
  ): Promise<void> {
    if (nodes.every((node) => node.type !== 'menu')) {
      return;
    }

    const childFlows = await manager.find(CallFlowEntity, {
      where: { parentFlowId: flow.id },
      order: { id: 'ASC' },
    });

    for (const node of nodes) {
      if (node.type !== 'menu') {
        continue;
      }

      const nodeChildFlows = childFlows.filter((child) => child.parentNodeKey === node.nodeKey);
      if (nodeChildFlows.length === 0) {
        continue;
      }

      const legacyFlow = nodeChildFlows.find((child) => child.id === Number(node.subflowId || 0))
        ?? nodeChildFlows.find((child) => child.parentBranchKey === null);
      if (!legacyFlow || legacyFlow.parentBranchKey !== null) {
        continue;
      }

      const legacyBranchKey = this.resolveLegacyMenuBranchKey(node.configJson);
      if (!legacyBranchKey) {
        continue;
      }

      const branchTaken = nodeChildFlows.some(
        (child) => String(child.parentBranchKey || '').trim() === legacyBranchKey,
      );
      if (branchTaken) {
        continue;
      }

      legacyFlow.parentBranchKey = legacyBranchKey;
      await manager.save(CallFlowEntity, legacyFlow);
    }
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
