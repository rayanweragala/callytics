import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AudioService } from './audio.service';
import { AudioFileEntity } from './entities/audio-file.entity';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

describe('AudioService', () => {
  let service: AudioService;
  let audioRepo: any;
  let dataSource: any;

  const mockRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: getRepositoryToken(AudioFileEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<AudioService>(AudioService);
    audioRepo = module.get(getRepositoryToken(AudioFileEntity));
    dataSource = module.get(getDataSourceToken());
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should return paginated audio files', async () => {
      const items = [{ id: 1, name: 'Audio 1', sourceType: 'upload', createdAt: new Date(), updatedAt: new Date() }];
      audioRepo.findAndCount.mockResolvedValue([items, 1]);

      const result = await service.list(1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('getOne', () => {
    it('should return audio file detail', async () => {
      const item = { id: 1, name: 'Audio 1', sourceType: 'upload', createdAt: new Date(), updatedAt: new Date() };
      audioRepo.findOne.mockResolvedValue(item);

      const result = await service.getOne(1);

      expect(result.data.id).toBe(1);
    });

    it('should throw NotFoundException when not found', async () => {
      audioRepo.findOne.mockResolvedValue(null);
      await expect(service.getOne(1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listVoices', () => {
    it('should return list of voices from installed model files', async () => {
      jest.spyOn(fs, 'readdir').mockResolvedValue([
        'en_US-lessac-medium.onnx',
        'en_US-lessac-medium.onnx.json',
        'README.md',
      ] as any);

      const result = await service.listVoices();

      expect(result.data).toEqual([
        { value: 'en_US-lessac-medium', label: 'English US — Lessac (Medium)' },
      ]);
    });
  });

  describe('upload', () => {
    it('should upload and process audio', async () => {
      const file = { originalname: 'test.mp3', buffer: Buffer.from('test'), mimetype: 'audio/mpeg' } as Express.Multer.File;
      const asset = { id: 1, name: 'test', storagePathOriginal: 'orig', sourceType: 'upload', createdAt: new Date(), updatedAt: new Date() };
      audioRepo.create.mockReturnValue(asset);
      audioRepo.save.mockResolvedValue(asset);
      audioRepo.findOne.mockResolvedValue(asset);

      jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);

      const mockSpawn = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
        }),
        stdin: { write: jest.fn(), end: jest.fn() },
      };
      (spawn as jest.Mock).mockReturnValue(mockSpawn);

      const result = await service.upload(file);

      expect(result.data.id).toBe(1);
    });

    it('should throw BadRequestException if file is missing', async () => {
      await expect(service.upload(null as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('createTts', () => {
    it('should create TTS audio', async () => {
      const asset = { id: 1, name: 'tts', storagePathOriginal: 'tts.wav', sourceType: 'tts', createdAt: new Date(), updatedAt: new Date() };
      audioRepo.create.mockReturnValue(asset);
      audioRepo.save.mockResolvedValue(asset);
      audioRepo.findOne.mockResolvedValue(asset);
      
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);
      jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);

      const mockSpawn = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(0);
        }),
        stdin: { write: jest.fn(), end: jest.fn() },
      };
      (spawn as jest.Mock).mockReturnValue(mockSpawn);

      const result = await service.createTts('name', 'text', 'voice');

      expect(result.data.id).toBe(1);
    });

    it('should throw BadRequestException if text is empty', async () => {
      await expect(service.createTts('name', '  ', 'voice')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if speed is out of range', async () => {
      await expect(service.createTts('name', 'text', 'voice', 5)).rejects.toThrow(BadRequestException);
    });
  });

  describe('previewTts', () => {
    it('should throw BadRequestException if text is empty', async () => {
      await expect(service.previewTts('  ', 'voice', 1, 0, true, {} as any)).rejects.toThrow(BadRequestException);
    });

    it('should handle ffmpeg failure', async () => {
      const res = { on: jest.fn() };
      jest.spyOn(fs, 'access').mockResolvedValue(undefined);

      const mockPiper = {
        killed: false, kill: jest.fn(),
        stdout: { pipe: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        stdin: { write: jest.fn(), end: jest.fn() },
      };
      const mockFfmpeg = {
        killed: false, kill: jest.fn(),
        stdout: { pipe: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(1); // fail
        }),
      };

      (spawn as jest.Mock)
        .mockReturnValueOnce(mockPiper)
        .mockReturnValueOnce(mockFfmpeg);

      await expect(service.previewTts('text', 'voice', 1, 0, true, res as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('should remove audio file if not used', async () => {
      const item = { id: 1, storagePathOriginal: 'orig' };
      audioRepo.findOne.mockResolvedValue(item);
      mockDataSource.query.mockResolvedValue([{ count: 0 }]);

      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const result = await service.remove(1);

      expect(result.data.deleted).toBe(true);
      expect(audioRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });

    it('should throw NotFoundException if audio file does not exist', async () => {
      audioRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if audio file is used', async () => {
      const item = { id: 1 };
      audioRepo.findOne.mockResolvedValue(item);
      mockDataSource.query.mockResolvedValue([{ count: 1 }]);

      await expect(service.remove(1)).rejects.toThrow(BadRequestException);
    });
  });

  describe('processAudio failure', () => {
    it('should mark conversion as failed if ffmpeg fails', async () => {
      const asset = { id: 1, name: 'test', storagePathOriginal: 'orig' };
      audioRepo.findOne.mockResolvedValue(asset);
      audioRepo.update.mockResolvedValue({});

      const mockSpawn = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') cb(1); // fail
        }),
        stdin: { write: jest.fn(), end: jest.fn() },
      };
      (spawn as jest.Mock).mockReturnValue(mockSpawn);

      // Trigger via upload to reach processAudio
      const file = { originalname: 'test.mp3', buffer: Buffer.from('test'), mimetype: 'audio/mpeg' } as Express.Multer.File;
      audioRepo.create.mockReturnValue(asset);
      audioRepo.save.mockResolvedValue(asset);
      jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      
      await expect(service.upload(file)).rejects.toThrow(BadRequestException);
      expect(audioRepo.update).toHaveBeenCalledWith({ id: 1 }, { conversionStatus: 'failed' });
    });
  });
});
