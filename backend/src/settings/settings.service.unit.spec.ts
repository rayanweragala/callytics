import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';

describe('SettingsService', () => {
  let service: SettingsService;
  const dataSource = {
    query: jest.fn(),
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
        { provide: getRepositoryToken(SipTrunkEntity), useValue: trunksRepository },
      ],
    }).compile();

    service = module.get(SettingsService);
  });

  it('returns the single settings row', async () => {
    dataSource.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ default_outbound_trunk_id: 7, record_outbound_calls: true }]);

    await expect(service.getSettings()).resolves.toEqual({
      data: {
        default_outbound_trunk_id: 7,
        record_outbound_calls: true,
      },
    });
  });

  it('rejects update when the default trunk does not exist', async () => {
    dataSource.query.mockResolvedValue(undefined);
    trunksRepository.findOne.mockResolvedValue(null);

    await expect(service.updateSettings({ default_outbound_trunk_id: 99 })).rejects.toThrow(BadRequestException);
  });

  it('returns null from getDefaultTrunk when the configured trunk is disabled or missing', async () => {
    dataSource.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ default_outbound_trunk_id: 4, record_outbound_calls: false }]);
    trunksRepository.findOne.mockResolvedValue(null);

    await expect(service.getDefaultTrunk()).resolves.toEqual({ data: null });
  });
});
