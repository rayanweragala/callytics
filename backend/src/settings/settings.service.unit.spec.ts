import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { SettingsEntity } from './settings.entity';

describe('SettingsService', () => {
  let service: SettingsService;
  const dataSource = {
    query: jest.fn(),
  };
  const settingsRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    merge: jest.fn(),
    save: jest.fn(),
  };
  const trunksRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(SettingsEntity), useValue: settingsRepository },
        { provide: getRepositoryToken(SipTrunkEntity), useValue: trunksRepository },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  it('returns settings as a flat key-value object', async () => {
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === 'recording_retention_days'
        ? { id: 3, key: 'recording_retention_days', value: '0' }
        : where.key === 'record_outbound_calls'
          ? { id: 2, key: 'record_outbound_calls', value: 'true' }
          : { id: 1, key: 'default_outbound_trunk_id', value: '7' }
    ));
    settingsRepository.find.mockResolvedValue([
      { id: 1, key: 'default_outbound_trunk_id', value: '7' },
      { id: 2, key: 'record_outbound_calls', value: 'true' },
      { id: 3, key: 'recording_retention_days', value: '0' },
    ]);

    await expect(service.getAll()).resolves.toEqual({
      default_outbound_trunk_id: 7,
      record_outbound_calls: true,
      recording_retention_days: 0,
    });
  });

  it('rejects update when the default trunk does not exist', async () => {
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === 'default_outbound_trunk_id'
        ? { id: 1, key: 'default_outbound_trunk_id', value: null }
        : where.key === 'record_outbound_calls'
          ? { id: 2, key: 'record_outbound_calls', value: 'false' }
          : { id: 3, key: 'recording_retention_days', value: '0' }
    ));
    trunksRepository.findOne.mockResolvedValue(null);

    const debugSpy = jest.spyOn(service['logger'], 'debug').mockImplementation();
    try {
      await expect(service.updateMany({ default_outbound_trunk_id: 99 })).rejects.toThrow(BadRequestException);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('returns null from getDefaultTrunk when the configured trunk is disabled or missing', async () => {
    settingsRepository.findOne.mockImplementation(async ({ where }: { where: { key: string } }) => (
      where.key === 'default_outbound_trunk_id'
        ? { id: 1, key: 'default_outbound_trunk_id', value: '4' }
        : where.key === 'record_outbound_calls'
          ? { id: 2, key: 'record_outbound_calls', value: 'false' }
          : { id: 3, key: 'recording_retention_days', value: '0' }
    ));
    trunksRepository.findOne.mockResolvedValue(null);

    await expect(service.getDefaultTrunk()).resolves.toEqual({ data: null });
  });
});
