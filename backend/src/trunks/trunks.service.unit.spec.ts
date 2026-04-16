import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TrunksService } from './trunks.service';
import { SipTrunkEntity } from './entities/sip-trunk.entity';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import * as net from 'net';

jest.mock('net');

describe('TrunksService', () => {
  let service: TrunksService;
  let trunksRepo: any;
  let asteriskConfigService: any;

  const mockRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockAsteriskConfigService = {
    writeTrunksConfig: jest.fn().mockResolvedValue(undefined),
    reloadResPjsip: jest.fn().mockResolvedValue(undefined),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrunksService,
        { provide: getRepositoryToken(SipTrunkEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsteriskConfigService },
      ],
    }).compile();

    service = module.get<TrunksService>(TrunksService);
    trunksRepo = module.get(getRepositoryToken(SipTrunkEntity));
    asteriskConfigService = module.get(AsteriskConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should return paginated trunks', async () => {
      const items = [{ id: 1, name: 'Trunk 1', createdAt: new Date() }];
      trunksRepo.findAndCount.mockResolvedValue([items, 1]);

      const result = await service.list(10, 0);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('create', () => {
    it('should create a new trunk', async () => {
      const dto = { name: 'Trunk 1', host: 'localhost', providerPreset: 'generic' };
      const entity = { ...dto, id: 1, port: 5060, enabled: true, createdAt: new Date() };
      trunksRepo.create.mockReturnValue(entity);
      trunksRepo.save.mockResolvedValue(entity);

      const result = await service.create(dto);

      expect(result.data.id).toBe(1);
      expect(asteriskConfigService.writeTrunksConfig).toHaveBeenCalled();
    });

    it('should throw BadRequestException if name is missing', async () => {
      await expect(service.create({ name: '', host: 'localhost' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update an existing trunk', async () => {
      const entity = { id: 1, name: 'Old', host: 'old.com', createdAt: new Date() };
      const dto = { name: 'New' };
      trunksRepo.findOne.mockResolvedValue(entity);
      trunksRepo.save.mockResolvedValue({ ...entity, name: 'New' });

      const result = await service.update(1, dto);

      expect(result.data.name).toBe('New');
    });

    it('should throw NotFoundException if not found', async () => {
      trunksRepo.findOne.mockResolvedValue(null);
      await expect(service.update(1, {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove a trunk', async () => {
      const entity = { id: 1 };
      trunksRepo.findOne.mockResolvedValue(entity);

      await service.remove(1);

      expect(trunksRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });
  });

  describe('test', () => {
    it('should return reachable status when TCP ping succeeds', async () => {
      const entity = { id: 1, host: 'localhost', port: 5060 };
      trunksRepo.findOne.mockResolvedValue(entity);

      const mockSocket = {
        setTimeout: jest.fn(),
        connect: jest.fn((port, host, cb) => cb()),
        on: jest.fn(),
        destroy: jest.fn(),
      };
      (net.Socket as any).mockReturnValue(mockSocket);

      const result = await service.test(1);

      expect(result.status).toBe('reachable');
    });

    it('should return unreachable status when TCP ping fails', async () => {
      const entity = { id: 1, host: 'localhost', port: 5060 };
      trunksRepo.findOne.mockResolvedValue(entity);

      const mockSocket = {
        setTimeout: jest.fn(),
        connect: jest.fn(),
        on: jest.fn((event, cb) => {
          if (event === 'error') cb({ message: 'refused', code: 'ECONNREFUSED' });
        }),
        destroy: jest.fn(),
      };
      (net.Socket as any).mockReturnValue(mockSocket);

      const result = await service.test(1);

      expect(result.status).toBe('unreachable');
    });
  });
});
