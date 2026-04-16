import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { CallRecordingEntity } from './entities/call-recording.entity';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { promises as fs } from 'fs';

describe('RecordingsService', () => {
  let service: RecordingsService;
  let recordingsRepo: any;
  let flowsRepo: any;

  const mockRecordingsRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
  };

  const mockFlowsRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingsService,
        { provide: getRepositoryToken(CallRecordingEntity), useValue: mockRecordingsRepo },
        { provide: getRepositoryToken(CallFlowEntity), useValue: mockFlowsRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<RecordingsService>(RecordingsService);
    recordingsRepo = module.get(getRepositoryToken(CallRecordingEntity));
    flowsRepo = module.get(getRepositoryToken(CallFlowEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should return paginated recordings', async () => {
      const items = [{ id: 1, callId: 'call-1', startedAt: new Date(), createdAt: new Date() }];
      recordingsRepo.findAndCount.mockResolvedValue([items, 1]);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.list(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getOne', () => {
    it('should return a recording', async () => {
      const item = { id: 1, callId: 'call-1', startedAt: new Date(), createdAt: new Date() };
      recordingsRepo.findOne.mockResolvedValue(item);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.getOne(1);

      expect(result.data.id).toBe(1);
    });

    it('should throw NotFoundException if not found', async () => {
      recordingsRepo.findOne.mockResolvedValue(null);
      await expect(service.getOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createInternal', () => {
    it('should create a recording record', async () => {
      const dto = {
        callId: 'call-1',
        channelId: 'chan-1',
        fileName: 'test.wav',
        filePath: '/tmp/test.wav',
        format: 'wav',
        startedAt: new Date().toISOString(),
      };
      const entity = { ...dto, id: 1, startedAt: new Date(), createdAt: new Date() };
      recordingsRepo.create.mockReturnValue(entity);
      recordingsRepo.save.mockResolvedValue(entity);
      recordingsRepo.findOne.mockResolvedValue(entity);
      mockFlowsRepo.find.mockResolvedValue([]);

      const result = await service.createInternal(dto);

      expect(result.data.id).toBe(1);
    });

    it('should throw BadRequestException for invalid filename', async () => {
      await expect(service.createInternal({ fileName: '../invalid' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getFilePath', () => {
    it('should return file path if file exists', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);

      const result = await service.getFilePath(1);

      expect(result).toBe('/tmp/test.wav');
    });

    it('should throw NotFoundException if file does not exist', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('no access'));

      await expect(service.getFilePath(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove recording record and file', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(recordingsRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });

    it('should ignore ENOENT error on unlink', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      const error = new Error() as any;
      error.code = 'ENOENT';
      jest.spyOn(fs, 'unlink').mockRejectedValue(error);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
    });

    it('should throw InternalServerErrorException on other unlink errors', async () => {
      const item = { id: 1, filePath: '/tmp/test.wav' };
      recordingsRepo.findOne.mockResolvedValue(item);
      jest.spyOn(fs, 'unlink').mockRejectedValue(new Error('other'));

      await expect(service.remove(1)).rejects.toThrow(InternalServerErrorException);
    });
  });
});
