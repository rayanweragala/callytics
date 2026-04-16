import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExtensionsService } from './extensions.service';
import { SipExtensionEntity } from './entities/sip-extension.entity';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';

describe('ExtensionsService', () => {
  let service: ExtensionsService;
  let extensionsRepo: any;
  let asteriskConfigService: any;

  const mockRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
  };

  const mockAsteriskConfigService = {
    syncExtensions: jest.fn().mockResolvedValue(undefined),
    writeExtensionsConfig: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtensionsService,
        { provide: getRepositoryToken(SipExtensionEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsteriskConfigService },
      ],
    }).compile();

    service = module.get<ExtensionsService>(ExtensionsService);
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
    it('should return paginated extensions', async () => {
      const items = [{ id: 1, username: '100', createdAt: new Date() }];
      extensionsRepo.findAndCount.mockResolvedValue([items, 1]);

      const result = await service.list(10, 0);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('create', () => {
    it('should create a new extension', async () => {
      const dto = { username: '100', password: 'password', displayName: 'User 100' };
      const entity = { ...dto, id: 1, createdAt: new Date() };
      extensionsRepo.findOne.mockResolvedValue(null);
      extensionsRepo.create.mockReturnValue(entity);
      extensionsRepo.save.mockResolvedValue(entity);
      extensionsRepo.find.mockResolvedValue([entity]);

      const result = await service.create(dto);

      expect(result.data.id).toBe(1);
      expect(asteriskConfigService.syncExtensions).toHaveBeenCalled();
    });

    it('should throw BadRequestException if username already exists', async () => {
      extensionsRepo.findOne.mockResolvedValue({ id: 1 });
      await expect(service.create({ username: '100', password: 'p' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update an existing extension', async () => {
      const entity = { id: 1, username: '100', password: 'old', createdAt: new Date() };
      const dto = { password: 'new' };
      extensionsRepo.findOne.mockResolvedValue(entity);
      extensionsRepo.save.mockResolvedValue({ ...entity, password: 'new' });
      extensionsRepo.find.mockResolvedValue([{ ...entity, password: 'new' }]);

      const result = await service.update(1, dto);

      expect(result.data.password).toBe('new');
    });

    it('should throw NotFoundException if not found', async () => {
      extensionsRepo.findOne.mockResolvedValue(null);
      await expect(service.update(1, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove an extension', async () => {
      const entity = { id: 1 };
      extensionsRepo.findOne.mockResolvedValue(entity);
      extensionsRepo.find.mockResolvedValue([]);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(extensionsRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });
  });
});
