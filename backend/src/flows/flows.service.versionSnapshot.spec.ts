import { Test, TestingModule } from '@nestjs/testing';
import { FlowsService } from './flows.service';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { CallFlowEntity } from './entities/call-flow.entity';
import { FlowVersionEntity } from './entities/flow-version.entity';

describe('FlowsService version snapshot logic', () => {
  let service: FlowsService;
  let dataSource: DataSource;
  let mockManager: any;

  beforeEach(async () => {
    mockManager = {
      findOne: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      findOneOrFail: vi.fn(),
      create: vi.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlowsService,
        {
          provide: DataSource,
          useValue: {
            transaction: vi.fn((cb) => cb(mockManager)),
          },
        },
        { provide: 'CallFlowEntityRepository', useValue: {} },
        { provide: 'FlowVersionEntityRepository', useValue: {} },
      ],
    }).compile();

    service = module.get<FlowsService>(FlowsService);
    dataSource = module.get<DataSource>(DataSource);
  });

  it('update() saves nodes/edges in-place on existing version', async () => {
    const mockFlow = { id: 1, currentVersionId: 10 };
    const mockLatestVersion = { id: 10, versionNumber: 1 };
    
    mockManager.findOne.mockImplementation((entity: any) => {
      if (entity === CallFlowEntity) return Promise.resolve(mockFlow);
      if (entity === FlowVersionEntity) return Promise.resolve(mockLatestVersion);
      return Promise.resolve(null);
    });
    
    mockManager.findOneOrFail.mockImplementation((entity: any) => {
      if (entity === CallFlowEntity) return Promise.resolve(mockFlow);
      if (entity === FlowVersionEntity) return Promise.resolve(mockLatestVersion);
      return Promise.resolve(null);
    });

    service.normalizeNodesForSave = vi.fn().mockResolvedValue([]);
    service.saveNodesAndEdges = vi.fn().mockResolvedValue(true);
    service.buildFlowDetail = vi.fn().mockResolvedValue({});

    await service.update(1, { name: 'Test', nodes: [], edges: [] });

    // Ensure we delete existing nodes/edges for the version to update in-place
    expect(mockManager.delete).toHaveBeenCalledWith(expect.anything(), { flowVersionId: 10 });
    
    // Ensure we save nodes/edges under that SAME version
    expect(service.saveNodesAndEdges).toHaveBeenCalledWith(mockManager, 10, [], []);
    
    // Crucially, verify createStoredVersion is NEVER called
    expect(mockManager.save).not.toHaveBeenCalledWith(FlowVersionEntity, expect.objectContaining({ message: expect.any(String) }));
  });

  it('createVersion() correctly inserts a new flow_versions row', async () => {
    const mockFlow = { id: 1 };
    const mockLatestVersion = { id: 10, versionNumber: 2 };
    
    mockManager.findOne.mockImplementation((entity: any) => {
      if (entity === CallFlowEntity) return Promise.resolve(mockFlow);
      if (entity === FlowVersionEntity) return Promise.resolve(mockLatestVersion);
      return Promise.resolve(null);
    });

    service.buildFlowSnapshot = vi.fn().mockResolvedValue({});
    service.createStoredVersion = vi.fn().mockResolvedValue({ id: 11 });
    mockManager.findOneOrFail.mockResolvedValue({ id: 11 });
    service.mapFlowVersionSummary = vi.fn().mockReturnValue({});

    await service.createVersion(1, 'Manual commit');

    // Expected to create a new version with versionNumber + 1
    expect(service.createStoredVersion).toHaveBeenCalledWith(
      mockManager,
      1,
      3, // previous was 2
      expect.anything(),
      'Manual commit'
    );
  });
});
