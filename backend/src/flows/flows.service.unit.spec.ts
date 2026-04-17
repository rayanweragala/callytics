import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FlowsService, validateNodeConfig, validateNodesConfig } from './flows.service';
import { CallFlowEntity } from './entities/call-flow.entity';
import { FlowVersionEntity } from './entities/flow-version.entity';
import { FlowNodeEntity } from './entities/flow-node.entity';
import { FlowEdgeEntity } from './entities/flow-edge.entity';

describe('FlowsService', () => {
  let service: FlowsService;
  let callFlowsRepo: any;
  let flowVersionsRepo: any;
  let flowNodesRepo: any;
  let flowEdgesRepo: any;
  let dataSource: any;
  let mockManager: any;

  const createMockRepo = () => ({
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
    findOneOrFail: jest.fn(),
  });

  beforeEach(async () => {
    mockManager = {
      getRepository: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      }),
    };

    const mockDataSource = {
      transaction: jest.fn((cb) => cb(mockManager)),
      query: jest.fn(),
      manager: mockManager,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlowsService,
        { provide: getRepositoryToken(CallFlowEntity), useValue: createMockRepo() },
        { provide: getRepositoryToken(FlowVersionEntity), useValue: createMockRepo() },
        { provide: getRepositoryToken(FlowNodeEntity), useValue: createMockRepo() },
        { provide: getRepositoryToken(FlowEdgeEntity), useValue: createMockRepo() },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<FlowsService>(FlowsService);
    callFlowsRepo = module.get(getRepositoryToken(CallFlowEntity));
    flowVersionsRepo = module.get(getRepositoryToken(FlowVersionEntity));
    flowNodesRepo = module.get(getRepositoryToken(FlowNodeEntity));
    flowEdgesRepo = module.get(getRepositoryToken(FlowEdgeEntity));
    dataSource = module.get(getDataSourceToken());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated flows', async () => {
      const flows = [{ id: 1, name: 'Flow 1', description: 'Desc 1', createdAt: new Date() }];
      callFlowsRepo.findAndCount.mockResolvedValue([flows, 1]);

      const result = await service.findAll(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return flow detail when found', async () => {
      const flow = { id: 1, name: 'Flow 1', slug: 'f1', currentVersionId: 10, createdAt: new Date(), updatedAt: new Date() };
      const version = { id: 10, versionNumber: 1, createdAt: new Date() };
      callFlowsRepo.findOne.mockResolvedValue(flow);
      flowVersionsRepo.findOne.mockResolvedValue(version);
      mockManager.find.mockResolvedValue([]);

      const result = await service.findOne(1);

      expect(result.data.id).toBe(1);
      expect(result.data.versionId).toBe(10);
    });

    it('should throw NotFoundException when flow not found', async () => {
      callFlowsRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });

    it('should fall back to latest version if currentVersionId is null', async () => {
      const flow = { id: 1, name: 'Flow 1', slug: 'f1', currentVersionId: null, createdAt: new Date(), updatedAt: new Date() };
      const version = { id: 20, versionNumber: 5, createdAt: new Date() };
      callFlowsRepo.findOne.mockResolvedValue(flow);
      flowVersionsRepo.findOne.mockResolvedValue(version);
      mockManager.find.mockResolvedValue([]);

      const result = await service.findOne(1);

      expect(result.data.versionId).toBe(20);
      expect(flowVersionsRepo.findOne).toHaveBeenCalledWith({
        where: { flowId: flow.id },
        order: { versionNumber: 'DESC' },
      });
    });

    it('should throw NotFoundException if currentVersionId is null and no versions exist', async () => {
      const flow = { id: 1, name: 'Flow 1', currentVersionId: null };
      callFlowsRepo.findOne.mockResolvedValue(flow);
      flowVersionsRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if version record is missing', async () => {
      const flow = { id: 1, currentVersionId: 99 };
      callFlowsRepo.findOne.mockResolvedValue(flow);
      flowVersionsRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create a new flow', async () => {
      const dto = { name: 'New Flow', nodes: [], edges: [] };
      const savedFlow = { id: 1, name: 'New Flow', slug: 'new-flow', createdAt: new Date(), updatedAt: new Date() };
      const savedVersion = { id: 10, versionNumber: 1, createdAt: new Date() };

      mockManager.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
      mockManager.create.mockReturnValueOnce(savedFlow).mockReturnValueOnce(savedVersion);
      mockManager.save.mockResolvedValueOnce(savedFlow).mockResolvedValueOnce(savedVersion).mockResolvedValueOnce(savedFlow);
      mockManager.findOneOrFail.mockResolvedValueOnce(savedFlow).mockResolvedValueOnce(savedVersion);
      mockManager.find.mockResolvedValue([]);

      const result = await service.create(dto);

      expect(result.data.id).toBe(1);
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should create a subflow when parentFlowId is provided', async () => {
      const dto = { name: 'Sub', parentFlowId: 1, parentNodeKey: 'n1', nodes: [], edges: [] };
      const savedFlow = { id: 2, name: 'Sub', slug: 'sub', entryType: 'subflow', createdAt: new Date(), updatedAt: new Date() };
      const savedVersion = { id: 10, versionNumber: 1, createdAt: new Date() };

      mockManager.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
      mockManager.create.mockReturnValueOnce(savedFlow).mockReturnValueOnce(savedVersion);
      mockManager.save.mockResolvedValueOnce(savedFlow).mockResolvedValueOnce(savedVersion).mockResolvedValueOnce(savedFlow);
      mockManager.findOneOrFail.mockResolvedValueOnce(savedFlow).mockResolvedValueOnce(savedVersion);
      mockManager.find.mockResolvedValue([]);

      const result = await service.create(dto);

      expect(result.data.parentFlowId).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update an existing flow in-place on the latest version', async () => {
      const flow = { id: 1, name: 'Old Flow', slug: 'old-flow', createdAt: new Date(), updatedAt: new Date() };
      const dto = { name: 'Updated Flow', slug: 'new-slug', nodes: [], edges: [] };
      const latestVersion = { id: 11, versionNumber: 1, createdAt: new Date() };

      mockManager.findOne.mockResolvedValueOnce(flow).mockResolvedValueOnce(latestVersion); // flow then latestVersion
      mockManager.save.mockResolvedValue(flow);
      mockManager.findOneOrFail.mockResolvedValueOnce(flow).mockResolvedValueOnce(latestVersion);
      mockManager.find.mockResolvedValue([]);
      mockManager.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });

      const result = await service.update(1, dto);

      expect(result.data.slug).toBe('new-slug');
    });

    it('should throw NotFoundException if flow to update does not exist', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(service.update(1, { name: 'New', nodes: [], edges: [] })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove a flow and its versions', async () => {
      const flow = { id: 1 };
      mockManager.findOne.mockResolvedValue(flow);
      mockManager.find.mockResolvedValue([{ id: 10 }]);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(mockManager.delete).toHaveBeenCalledWith(CallFlowEntity, { id: 1 });
    });

    it('should handle flow removal with no versions', async () => {
      const flow = { id: 1 };
      mockManager.findOne.mockResolvedValue(flow);
      mockManager.find.mockResolvedValue([]); // no versions

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(mockManager.delete).toHaveBeenCalledWith(CallFlowEntity, { id: 1 });
    });

    it('should throw NotFoundException if flow to remove does not exist', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listVersions', () => {
    it('should list all versions of a flow', async () => {
      const versions = [
        { id: 10, flowId: 1, versionNumber: 1, message: 'v1', nodeCount: 5, snapshot: {}, createdAt: new Date() }
      ];
      callFlowsRepo.findOne.mockResolvedValue({ id: 1 });
      flowVersionsRepo.find.mockResolvedValue(versions);

      const result = await service.listVersions(1);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(10);
    });

    it('should filter out invalid versions', async () => {
      const versions = [
        { id: 10, flowId: 1, versionNumber: 1, message: 'v1', nodeCount: 5, snapshot: {}, createdAt: new Date() },
        { id: 11, flowId: 1, versionNumber: 2, snapshot: null } // should be filtered out
      ];
      callFlowsRepo.findOne.mockResolvedValue({ id: 1 });
      flowVersionsRepo.find.mockResolvedValue(versions);

      const result = await service.listVersions(1);

      expect(result.data).toHaveLength(1);
    });
  });

  describe('findVersion', () => {
    it('should return a specific version', async () => {
      const version = { id: 10, flowId: 1, versionNumber: 1, message: 'v1', nodeCount: 5, snapshot: {}, createdAt: new Date() };
      callFlowsRepo.findOne.mockResolvedValue({ id: 1 });
      flowVersionsRepo.findOne.mockResolvedValue(version);

      const result = await service.findVersion(1, 10);

      expect(result.data.id).toBe(10);
    });

    it('should throw NotFoundException if version has no snapshot', async () => {
      const version = { id: 10, flowId: 1, snapshot: null };
      callFlowsRepo.findOne.mockResolvedValue({ id: 1 });
      flowVersionsRepo.findOne.mockResolvedValue(version);

      await expect(service.findVersion(1, 10)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createVersion', () => {
    it('should throw NotFoundException if flow for new version does not exist', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(service.createVersion(1, 'msg')).rejects.toThrow(NotFoundException);
    });
  });

  describe('restoreVersion', () => {
    it('should restore a specific version', async () => {
      const flow = { id: 1, name: 'Flow 1' };
      const version = { id: 10, versionNumber: 1, snapshot: { nodes: [], edges: [] } };
      mockManager.findOne.mockImplementation((entity, options) => {
        if (entity === CallFlowEntity) return Promise.resolve(flow);
        if (entity === FlowVersionEntity) return Promise.resolve(version);
        return Promise.resolve(null);
      });
      mockManager.create.mockReturnValue({ id: 12, versionNumber: 2 });
      mockManager.save.mockResolvedValue({ id: 12, versionNumber: 2 });

      const result = await service.restoreVersion(1, 10);

      expect(result.data.success).toBe(true);
    });

    it('should throw NotFoundException if flow to restore does not exist', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(service.restoreVersion(1, 10)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if version to restore does not exist', async () => {
      mockManager.findOne.mockImplementation((entity) => {
        if (entity === CallFlowEntity) return Promise.resolve({ id: 1 });
        return Promise.resolve(null);
      });
      await expect(service.restoreVersion(1, 10)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBreadcrumb', () => {
    it('should return breadcrumb for a flow', async () => {
      const flow1 = { id: 1, name: 'Parent', parentFlowId: null };
      const flow2 = { id: 2, name: 'Child', parentFlowId: 1 };
      callFlowsRepo.findOne.mockResolvedValueOnce(flow2).mockResolvedValueOnce(flow1).mockResolvedValueOnce(null);

      const result = await service.getBreadcrumb(2);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].flowId).toBe(1);
      expect(result.data[1].flowId).toBe(2);
    });

    it('should throw NotFoundException if no breadcrumb found', async () => {
      callFlowsRepo.findOne.mockResolvedValue(null);
      await expect(service.getBreadcrumb(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFlowTree', () => {
    it('should return flow tree', async () => {
      const flow = { id: 1, name: 'Root', currentVersionId: 10 };
      callFlowsRepo.findOne.mockResolvedValue(flow);
      flowNodesRepo.find.mockResolvedValue([]);

      const result = await service.getFlowTree(1);

      expect(result.data.id).toBe(1);
    });

    it('should traverse flow tree with subflows', async () => {
      const rootFlow = { id: 1, name: 'Root', currentVersionId: 10 };
      const childFlow = { id: 2, name: 'Child' };
      const menuNode = { id: 1, type: 'menu', nodeKey: 'm1', label: 'Menu 1', subflowId: 2, configJson: { submenu_branch_targets: { '1': 'next' } } };
      
      callFlowsRepo.findOne.mockImplementation(({ where }) => {
        if (where.id === 1) return Promise.resolve(rootFlow);
        if (where.id === 2) return Promise.resolve(childFlow);
        return Promise.resolve(null);
      });
      flowNodesRepo.find.mockResolvedValue([menuNode]);

      const result = await service.getFlowTree(1);

      expect(result.data.children).toHaveLength(1);
      expect(result.data.children[0].subflowId).toBe(2);
    });

    it('should throw NotFoundException if root flow not found', async () => {
      callFlowsRepo.findOne.mockResolvedValue(null);
      await expect(service.getFlowTree(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createSubflow', () => {
    it('should create a new subflow if not existing', async () => {
      mockManager.findOne.mockResolvedValue(null); // not existing
      mockManager.getRepository.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) });
      const saved = { id: 2, updatedAt: new Date() };
      mockManager.create.mockReturnValue(saved);
      mockManager.save.mockResolvedValue(saved);

      const result = await service.createSubflow(1, 'n1', 'Subflow Name', mockManager);

      expect(result).toBe(2);
    });

    it('should return existing subflow id', async () => {
      mockManager.findOne.mockResolvedValue({ id: 2 });
      const result = await service.createSubflow(1, 'n1', 'Name', mockManager);
      expect(result).toBe(2);
    });
  });

  describe('validateNodeConfig', () => {
    it('should throw 400 for transfer node with empty destination', () => {
      const node = { nodeKey: 't1', type: 'transfer', config: { destination: '', timeout_ms: 30000 } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should throw 400 for transfer node with whitespace-only destination', () => {
      const node = { nodeKey: 't1', type: 'transfer', config: { destination: '   ', timeout_ms: 30000 } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should pass for transfer node with valid destination', () => {
      const node = { nodeKey: 't1', type: 'transfer', config: { destination: 'SIP/trunk/+123', timeout_ms: 30000 } };
      expect(() => validateNodeConfig(node)).not.toThrow();
    });

    it('should throw 400 for transfer node missing timeout_ms', () => {
      const node = { nodeKey: 't1', type: 'transfer', config: { destination: 'SIP/trunk' } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should throw 400 for transfer node with invalid timeout_ms', () => {
      const node = { nodeKey: 't1', type: 'transfer', config: { destination: 'SIP/trunk', timeout_ms: -100 } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should throw 400 for menu node with missing prompt_audio_file_id', () => {
      const node = { nodeKey: 'm1', type: 'menu', config: { prompt_audio_file_id: '', timeout_ms: 5000, branches: ['1', '2'] } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should throw 400 for menu node with invalid prompt_audio_file_id', () => {
      const node = { nodeKey: 'm1', type: 'menu', config: { prompt_audio_file_id: 'abc', timeout_ms: 5000, branches: ['1', '2'] } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should throw 400 for menu node with empty branches array', () => {
      const node = { nodeKey: 'm1', type: 'menu', config: { prompt_audio_file_id: 1, timeout_ms: 5000, branches: [] } };
      expect(() => validateNodeConfig(node)).toThrow(BadRequestException);
    });

    it('should pass for menu node with valid config', () => {
      const node = { nodeKey: 'm1', type: 'menu', config: { prompt_audio_file_id: 1, timeout_ms: 5000, branches: ['1', '2'] } };
      expect(() => validateNodeConfig(node)).not.toThrow();
    });
  });

  describe('validateNodesConfig', () => {
    it('should throw on first invalid node', () => {
      const nodes = [
        { nodeKey: 'm1', type: 'menu', config: { prompt_audio_file_id: 1, timeout_ms: 5000, branches: [] } },
      ];
      expect(() => validateNodesConfig(nodes)).toThrow(BadRequestException);
    });

    it('should pass for all valid nodes', () => {
      const nodes = [
        { nodeKey: 't1', type: 'transfer', config: { destination: 'SIP/123', timeout_ms: 30000 } },
        { nodeKey: 'm1', type: 'menu', config: { prompt_audio_file_id: 1, timeout_ms: 5000, branches: ['1'] } },
      ];
      expect(() => validateNodesConfig(nodes)).not.toThrow();
    });
  });
});
