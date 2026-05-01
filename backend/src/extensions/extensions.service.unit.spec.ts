import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ExtensionsService } from './extensions.service';
import { SipExtensionEntity } from './entities/sip-extension.entity';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { InboundRouteEntity } from '../inbound-routes/entities/inbound-route.entity';
import { VpnService } from '../vpn/vpn.service';

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('ExtensionsService', () => {
  let service: ExtensionsService;
  let extensionsRepo: typeof mockRepo;
  let inboundRoutesRepo: typeof mockInboundRoutesRepo;
  let asteriskConfigService: typeof mockAsteriskConfigService;
  let vpnService: typeof mockVpnService;

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

  const mockInboundRoutesRepo = {
    findOne: jest.fn(),
  };

  const mockVpnService = {
    isInstalled: jest.fn().mockResolvedValue(true),
  };

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExtensionsService,
        { provide: getRepositoryToken(SipExtensionEntity), useValue: mockRepo },
        { provide: getRepositoryToken(InboundRouteEntity), useValue: mockInboundRoutesRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsteriskConfigService },
        { provide: VpnService, useValue: mockVpnService },
      ],
    }).compile();

    service = module.get<ExtensionsService>(ExtensionsService);
    extensionsRepo = module.get(getRepositoryToken(SipExtensionEntity));
    inboundRoutesRepo = module.get(getRepositoryToken(InboundRouteEntity));
    asteriskConfigService = module.get(AsteriskConfigService);
    vpnService = module.get(VpnService);
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
      inboundRoutesRepo.findOne.mockResolvedValue(null);
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

    it('should create extension with vpnOnly=true when VPN is installed', async () => {
      const dto = { username: '101', password: 'password', displayName: 'User 101', vpnOnly: true as const };
      const entity = { ...dto, id: 2, transportType: 'sip' as const, createdAt: new Date() };
      extensionsRepo.findOne.mockResolvedValue(null);
      inboundRoutesRepo.findOne.mockResolvedValue(null);
      extensionsRepo.create.mockReturnValue(entity);
      extensionsRepo.save.mockResolvedValue(entity);
      extensionsRepo.find.mockResolvedValue([entity]);
      vpnService.isInstalled.mockResolvedValue(true);

      const result = await service.create(dto);

      expect(vpnService.isInstalled).toHaveBeenCalled();
      expect(result.data.vpnOnly).toBe(true);
    });

    it('should reject create with vpnOnly=true when VPN is not installed', async () => {
      extensionsRepo.findOne.mockResolvedValue(null);
      inboundRoutesRepo.findOne.mockResolvedValue(null);
      vpnService.isInstalled.mockResolvedValue(false);

      await expect(service.create({ username: '102', password: 'password', vpnOnly: true })).rejects.toThrow(
        'VPN is not installed. Enable WireGuard before restricting extensions to VPN-only.',
      );
      expect(extensionsRepo.save).not.toHaveBeenCalled();
    });

    it('should reject create when username matches an inbound DID', async () => {
      extensionsRepo.findOne.mockResolvedValue(null);
      inboundRoutesRepo.findOne.mockResolvedValue({ id: 9, did: '100' });

      await expect(service.create({ username: '100', password: 'password' })).rejects.toThrow(
        'This number is already in use as an inbound DID. Choose a different extension number.',
      );
      expect(extensionsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing extension', async () => {
      const entity = { id: 1, username: '100', password: 'old', createdAt: new Date() };
      const dto = { password: 'new' };
      extensionsRepo.findOne.mockResolvedValue(entity);
      inboundRoutesRepo.findOne.mockResolvedValue(null);
      extensionsRepo.save.mockResolvedValue({ ...entity, password: 'new' });
      extensionsRepo.find.mockResolvedValue([{ ...entity, password: 'new' }]);

      const result = await service.update(1, dto);

      expect(result.data.password).toBe('new');
    });

    it('should save VPN-only ACL config and trigger PJSIP reload through syncExtensions', async () => {
      const entity = {
        id: 1,
        username: '100',
        password: 'old',
        displayName: null,
        transportType: 'sip',
        vpnOnly: false,
        createdAt: new Date(),
      };
      extensionsRepo.findOne.mockResolvedValue(entity);
      extensionsRepo.save.mockResolvedValue({ ...entity, vpnOnly: true });
      extensionsRepo.find.mockResolvedValue([{ ...entity, vpnOnly: true }]);
      vpnService.isInstalled.mockResolvedValue(true);
      inboundRoutesRepo.findOne.mockResolvedValue(null);

      const result = await service.update(1, { vpnOnly: true });

      expect(result.data.vpnOnly).toBe(true);
      expect(asteriskConfigService.syncExtensions).toHaveBeenCalledWith([
        expect.objectContaining({
          endpointFlags: expect.arrayContaining(['acl = 100-vpn-acl', '#include pjsip_callytics_vpn_100.conf']),
        }),
      ]);
    });

    it('should fail VPN-only update when VPN is not installed', async () => {
      const entity = {
        id: 1,
        username: '100',
        password: 'old',
        displayName: null,
        transportType: 'sip',
        vpnOnly: false,
        createdAt: new Date(),
      };
      extensionsRepo.findOne.mockResolvedValue(entity);
      vpnService.isInstalled.mockResolvedValue(false);
      inboundRoutesRepo.findOne.mockResolvedValue(null);

      await expect(service.update(1, { vpnOnly: true })).rejects.toThrow('VPN is not installed. Enable WireGuard before restricting extensions to VPN-only.');
      expect(extensionsRepo.save).not.toHaveBeenCalled();
    });

    it('should reject username change when new username matches an inbound DID', async () => {
      const entity = { id: 1, username: '100', password: 'old', createdAt: new Date() };
      extensionsRepo.findOne
        .mockResolvedValueOnce(entity)
        .mockResolvedValueOnce(null);
      inboundRoutesRepo.findOne.mockResolvedValue({ id: 7, did: '200' });

      await expect(service.update(1, { username: '200' })).rejects.toThrow(
        'This number is already in use as an inbound DID. Choose a different extension number.',
      );
      expect(extensionsRepo.save).not.toHaveBeenCalled();
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
