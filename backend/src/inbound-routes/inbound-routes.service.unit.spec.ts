import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { InboundRoutesService } from './inbound-routes.service';
import { InboundRouteEntity } from './entities/inbound-route.entity';
import { SipExtensionEntity } from '../extensions/entities/sip-extension.entity';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';

describe('InboundRoutesService', () => {
  let service: InboundRoutesService;
  let inboundRoutesRepo: any;
  let flowsRepo: any;
  let extensionsRepo: any;
  let asteriskConfigService: any;

  const mockInboundRoutesRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
  };

  const mockFlowsRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockExtensionsRepo = {
    findOne: jest.fn(),
  };

  const mockAsteriskConfigService = {
    syncInboundRoutes: jest.fn().mockResolvedValue(undefined),
    writeInboundRoutesConfig: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboundRoutesService,
        { provide: getRepositoryToken(InboundRouteEntity), useValue: mockInboundRoutesRepo },
        { provide: getRepositoryToken(CallFlowEntity), useValue: mockFlowsRepo },
        { provide: getRepositoryToken(SipExtensionEntity), useValue: mockExtensionsRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsteriskConfigService },
      ],
    }).compile();

    service = module.get<InboundRoutesService>(InboundRoutesService);
    inboundRoutesRepo = module.get(getRepositoryToken(InboundRouteEntity));
    flowsRepo = module.get(getRepositoryToken(CallFlowEntity));
    extensionsRepo = module.get(getRepositoryToken(SipExtensionEntity));
    asteriskConfigService = module.get(AsteriskConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should return paginated inbound routes', async () => {
      const items = [{ id: 1, did: '123456', flowId: 1, createdAt: new Date() }];
      inboundRoutesRepo.findAndCount.mockResolvedValue([items, 1]);
      mockFlowsRepo.find.mockResolvedValue([{ id: 1, name: 'Flow 1' }]);

      const result = await service.list();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].flowName).toBe('Flow 1');
    });
  });

  describe('create', () => {
    it('should create a new inbound route', async () => {
      const dto = { did: '123456', flowId: 1, label: 'Route 1' };
      const entity = { ...dto, id: 1, createdAt: new Date() };
      mockFlowsRepo.findOne.mockResolvedValue({ id: 1 });
      mockExtensionsRepo.findOne.mockResolvedValue(null);
      inboundRoutesRepo.findOne.mockResolvedValue(null);
      inboundRoutesRepo.create.mockReturnValue(entity);
      inboundRoutesRepo.save.mockResolvedValue(entity);
      inboundRoutesRepo.find.mockResolvedValue([entity]);

      const result = await service.create(dto);

      expect(result.data.id).toBe(1);
      expect(asteriskConfigService.syncInboundRoutes).toHaveBeenCalled();
    });

    it('should throw BadRequestException if flow does not exist', async () => {
      mockFlowsRepo.findOne.mockResolvedValue(null);
      await expect(service.create({ did: '1', flowId: 99 })).rejects.toThrow(BadRequestException);
    });

    it('should reject create when DID matches an extension username', async () => {
      mockFlowsRepo.findOne.mockResolvedValue({ id: 1 });
      inboundRoutesRepo.findOne.mockResolvedValue(null);
      mockExtensionsRepo.findOne.mockResolvedValue({ id: 9, username: '123456' });

      await expect(service.create({ did: '123456', flowId: 1 })).rejects.toThrow(
        'This number is already in use as an extension. Choose a different DID.',
      );
      expect(inboundRoutesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing inbound route', async () => {
      const entity = { id: 1, did: '123456', flowId: 1, createdAt: new Date() };
      const dto = { did: '654321' };
      inboundRoutesRepo.findOne.mockResolvedValue(entity);
      mockExtensionsRepo.findOne.mockResolvedValue(null);
      inboundRoutesRepo.save.mockResolvedValue({ ...entity, did: '654321' });
      inboundRoutesRepo.find.mockResolvedValue([{ ...entity, did: '654321' }]);
      mockFlowsRepo.find.mockResolvedValue([{ id: 1, name: 'Flow 1' }]);

      const result = await service.update(1, dto);

      expect(result.data.did).toBe('654321');
    });

    it('should reject DID change when new DID matches an extension username', async () => {
      const entity = { id: 1, did: '123456', flowId: 1, createdAt: new Date() };
      inboundRoutesRepo.findOne
        .mockResolvedValueOnce(entity)
        .mockResolvedValueOnce(null);
      mockExtensionsRepo.findOne.mockResolvedValue({ id: 5, username: '654321' });

      await expect(service.update(1, { did: '654321' })).rejects.toThrow(
        'This number is already in use as an extension. Choose a different DID.',
      );
      expect(inboundRoutesRepo.save).not.toHaveBeenCalled();
    });

    it('should skip extension conflict check when update does not change the DID', async () => {
      const entity = { id: 1, did: '123456', flowId: 1, createdAt: new Date() };
      const newFlow = { id: 2 };
      inboundRoutesRepo.findOne.mockResolvedValue(entity);
      mockFlowsRepo.findOne.mockResolvedValue(newFlow);
      inboundRoutesRepo.save.mockResolvedValue({ ...entity, flowId: 2 });
      inboundRoutesRepo.find.mockResolvedValue([{ ...entity, flowId: 2 }]);
      mockFlowsRepo.find.mockResolvedValue([{ id: 2, name: 'Flow 2' }]);

      // Only changing flowId — did is not passed in the dto
      await service.update(1, { flowId: 2 });

      // The extensions repo must NOT be queried for a DID conflict
      expect(mockExtensionsRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if not found', async () => {
      inboundRoutesRepo.findOne.mockResolvedValue(null);
      await expect(service.update(1, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove an inbound route', async () => {
      const entity = { id: 1 };
      inboundRoutesRepo.findOne.mockResolvedValue(entity);
      inboundRoutesRepo.find.mockResolvedValue([]);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(inboundRoutesRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });
  });
});
