import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { BadRequestException } from '@nestjs/common';
import { VpnPeerEntity } from './entities/vpn-peer.entity';
import { VpnService } from './vpn.service';

jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      mkdir: jest.fn(),
      writeFile: jest.fn(),
      unlink: jest.fn(),
    },
  };
});
jest.mock('node:os');

type CommandRunner = (command: string, args: string[], stdin?: string) => Promise<string>;

describe('VpnService', () => {
  let service: VpnService;
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VpnService,
        { provide: getRepositoryToken(VpnPeerEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();

    service = module.get(VpnService);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-27T10:00:00.000Z'));
    (os.networkInterfaces as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  function mockProcNetDev(content: string): void {
    (fs.promises.readFile as jest.Mock).mockResolvedValue(content);
  }

  function spyRunCommand(handler: CommandRunner): jest.SpyInstance<Promise<string>, Parameters<CommandRunner>> {
    return jest.spyOn(service as unknown as { runCommand: CommandRunner }, 'runCommand').mockImplementation(handler);
  }

  it('GET /vpn/status returns installed and running status', async () => {
    mockProcNetDev('Inter-| Receive\n wg0: 1 2 3\n');
    spyRunCommand(async (_command, args) => {
      const joined = args.join(' ');
      if (joined === 'show wg0 public-key') {
        return 'server-public-key';
      }
      if (joined === 'show wg0 dump') {
        return 'priv\tserver-public-key\t51820\toff\npeer-a\t(none)\t198.51.100.1:51820\t10.8.0.2/32\t1777283910\t10\t20\t25';
      }
      return '';
    });

    const result = await service.getStatus();

    expect(result.installed).toBe(true);
    expect(result.running).toBe(true);
    expect(result.serverPublicKey).toBe('server-public-key');
    expect(result.peerCount).toBe(1);
    expect(result.subnetConflict).toBe(false);
  });

  it('GET /vpn/status returns not installed state when wg0 is absent', async () => {
    mockProcNetDev('Inter-| Receive\n eth0: 1 2 3\n');
    spyRunCommand(async () => {
      throw new Error('missing');
    });

    const result = await service.getStatus();

    expect(result).toEqual({
      installed: false,
      running: null,
      serverPublicKey: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });
  });

  it('GET /vpn/status reports subnet conflicts', async () => {
    mockProcNetDev('Inter-| Receive\n wg0: 1 2 3\n');
    (os.networkInterfaces as jest.Mock).mockReturnValue({
      eth1: [{ family: 'IPv4', address: '10.8.0.44' }],
    });
    spyRunCommand(async (_command, args) => {
      if (args.join(' ') === 'show wg0 public-key') {
        return 'server-public-key';
      }
      return '';
    });

    const result = await service.getStatus();

    expect(result.subnetConflict).toBe(true);
    expect(result.subnetConflictDetail).toContain('eth1 uses 10.8.0.44');
  });

  it('POST /vpn/peers creates a peer with the next available IP', async () => {
    mockProcNetDev('Inter-| Receive\n wg0: 1 2 3\n');
    mockRepo.find.mockResolvedValue([{ assignedIp: '10.8.0.2' }]);
    mockRepo.create.mockImplementation((value: Partial<VpnPeerEntity>) => value);
    mockRepo.save.mockImplementation(async (value: Partial<VpnPeerEntity>) => ({
      id: 5,
      createdAt: new Date('2026-04-27T10:00:00.000Z'),
      revokedAt: null,
      ...value,
    }));
    jest.spyOn(service as unknown as { generateKeyPair: () => Promise<{ privateKey: string; publicKey: string }> }, 'generateKeyPair')
      .mockResolvedValue({ privateKey: 'private-key', publicKey: 'public-key' });
    jest.spyOn(service as unknown as { addLivePeer: (peer: VpnPeerEntity) => Promise<void> }, 'addLivePeer')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { writePeerConfig: (peer: VpnPeerEntity, config: string) => Promise<void> }, 'writePeerConfig')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { getServerPublicKey: () => Promise<string | null> }, 'getServerPublicKey')
      .mockResolvedValue('server-public-key');

    const result = await service.createPeer('Alice Phone');

    expect(result.data.assignedIp).toBe('10.8.0.3');
    expect(result.data.privateKey).toBe('private-key');
    expect(mockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ publicKey: 'public-key' }));
  });

  it('POST /vpn/peers fails when the subnet is exhausted', async () => {
    mockProcNetDev('Inter-| Receive\n wg0: 1 2 3\n');
    mockRepo.find.mockResolvedValue(Array.from({ length: 253 }, (_value, index) => ({
      assignedIp: `10.8.0.${index + 2}`,
    })));

    await expect(service.createPeer('Full')).rejects.toThrow('VPN subnet is full');
  });

  it('DELETE /vpn/peers revokes a peer and removes it from WireGuard', async () => {
    const peer = {
      id: 7,
      name: 'Alice',
      assignedIp: '10.8.0.2',
      publicKey: 'peer-public',
      privateKey: 'peer-private',
      createdAt: new Date('2026-04-27T10:00:00.000Z'),
      revokedAt: null,
    };
    mockRepo.findOne.mockResolvedValue(peer);
    mockRepo.save.mockResolvedValue({ ...peer, revokedAt: new Date('2026-04-27T10:00:00.000Z') });
    const removeLivePeer = jest.spyOn(service as unknown as { removeLivePeer: (publicKey: string) => Promise<void> }, 'removeLivePeer')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { removePeerConfig: (item: VpnPeerEntity) => Promise<void> }, 'removePeerConfig')
      .mockResolvedValue(undefined);

    await service.revokePeer(7);

    expect(removeLivePeer).toHaveBeenCalledWith('peer-public');
    const savedPeer = mockRepo.save.mock.calls[0]?.[0] as VpnPeerEntity;
    expect(savedPeer.revokedAt).toBeInstanceOf(Date);
  });

  it('GET /vpn/peers classifies active, idle, and offline peers', async () => {
    mockRepo.find.mockResolvedValue([
      { id: 1, name: 'Active', assignedIp: '10.8.0.2', publicKey: 'active-key', privateKey: 'p', createdAt: new Date('2026-04-27T10:00:00.000Z') },
      { id: 2, name: 'Idle', assignedIp: '10.8.0.3', publicKey: 'idle-key', privateKey: 'p', createdAt: new Date('2026-04-27T10:00:00.000Z') },
      { id: 3, name: 'Offline', assignedIp: '10.8.0.4', publicKey: 'offline-key', privateKey: 'p', createdAt: new Date('2026-04-27T10:00:00.000Z') },
    ]);
    spyRunCommand(async () => [
      'priv\tserver-public-key\t51820\toff',
      'active-key\t(none)\t198.51.100.1:51820\t10.8.0.2/32\t1777283940\t10\t20\t25',
      'idle-key\t(none)\t198.51.100.2:51820\t10.8.0.3/32\t1777283580\t10\t20\t25',
      'offline-key\t(none)\t198.51.100.3:51820\t10.8.0.4/32\t1777283000\t10\t20\t25',
    ].join('\n'));

    const result = await service.listPeers();

    expect(result.map((peer) => peer.status)).toEqual(['active', 'idle', 'offline']);
  });

  it('POST /vpn/peers fails clearly when VPN is not installed', async () => {
    mockProcNetDev('Inter-| Receive\n eth0: 1 2 3\n');
    spyRunCommand(async () => {
      throw new Error('missing');
    });

    await expect(service.createPeer('Alice')).rejects.toThrow(BadRequestException);
  });
});
