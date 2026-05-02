import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { BadRequestException } from '@nestjs/common';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
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

interface PrivateVpnService {
  detectWireGuardRuntime: () => Promise<{ installed: boolean; running: boolean }>;
  getServerPublicKeyWithFallback: () => Promise<{ value: string | null; error: string | null }>;
  readWireGuardDump: () => Promise<Map<string, { publicKey: string; lastHandshakeEpoch: number; bytesReceived: number; bytesSent: number }>>;
  isInstalled: () => Promise<boolean>;
  generateKeyPair: () => Promise<{ privateKey: string; publicKey: string }>;
  ensureRelayKeyPair: () => Promise<{ privateKey: string; publicKey: string }>;
}

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
  const mockAsteriskConfigService = {
    syncUdpTransport: jest.fn(),
    syncExtensionsRelayConfig: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VpnService,
        { provide: getRepositoryToken(VpnPeerEntity), useValue: mockRepo },
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: AsteriskConfigService, useValue: mockAsteriskConfigService },
      ],
    }).compile();

    service = module.get(VpnService);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-27T10:00:00.000Z'));
    (os.networkInterfaces as jest.Mock).mockReturnValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockAsteriskConfigService.syncUdpTransport.mockReset();
    mockAsteriskConfigService.syncExtensionsRelayConfig.mockReset();
    delete process.env.HOST_IP;
    delete process.env.VPN_PUBLIC_IP;
  });

  function privateService(): PrivateVpnService {
    return service as unknown as PrivateVpnService;
  }

  it('GET /vpn/status returns installed and running status', async () => {
    jest.spyOn(privateService(), 'detectWireGuardRuntime').mockResolvedValue({ installed: true, running: true });
    jest.spyOn(privateService(), 'getServerPublicKeyWithFallback').mockResolvedValue({ value: 'server-public-key', error: null });
    jest.spyOn(privateService(), 'readWireGuardDump').mockResolvedValue(new Map([
      ['peer-a', { publicKey: 'peer-a', lastHandshakeEpoch: 1777283910, bytesReceived: 10, bytesSent: 20 }],
    ]));

    const result = await service.getStatus();

    expect(result.installed).toBe(true);
    expect(result.running).toBe(true);
    expect(result.serverPublicKey).toBe('server-public-key');
    expect(result.peerCount).toBe(1);
    expect(result.subnetConflict).toBe(false);
  });

  it('GET /vpn/status returns not installed state when wg0 is absent', async () => {
    jest.spyOn(privateService(), 'detectWireGuardRuntime').mockResolvedValue({ installed: false, running: false });

    const result = await service.getStatus();

    expect(result).toEqual({
      installed: false,
      running: null,
      serverPublicKey: null,
      serverPublicKeyError: null,
      endpoint: null,
      subnet: null,
      peerCount: 0,
      subnetConflict: false,
      subnetConflictDetail: null,
    });
  });

  it('GET /vpn/status reports subnet conflicts', async () => {
    jest.spyOn(privateService(), 'detectWireGuardRuntime').mockResolvedValue({ installed: true, running: true });
    jest.spyOn(privateService(), 'getServerPublicKeyWithFallback').mockResolvedValue({ value: 'server-public-key', error: null });
    jest.spyOn(privateService(), 'readWireGuardDump').mockResolvedValue(new Map());
    (os.networkInterfaces as jest.Mock).mockReturnValue({
      eth1: [{ family: 'IPv4', address: '10.8.0.44' }],
    });

    const result = await service.getStatus();

    expect(result.subnetConflict).toBe(true);
    expect(result.subnetConflictDetail).toContain('eth1 uses 10.8.0.44');
  });

  it('POST /vpn/peers creates a peer with the next available IP', async () => {
    jest.spyOn(privateService(), 'isInstalled').mockResolvedValue(true);
    mockRepo.find.mockResolvedValue([{ assignedIp: '10.8.0.2' }]);
    mockRepo.create.mockImplementation((value: Partial<VpnPeerEntity>) => value);
    mockRepo.save.mockImplementation(async (value: Partial<VpnPeerEntity>) => ({
      id: 5,
      createdAt: new Date('2026-04-27T10:00:00.000Z'),
      revokedAt: null,
      ...value,
    }));
    jest.spyOn(privateService(), 'generateKeyPair').mockResolvedValue({ privateKey: 'private-key', publicKey: 'public-key' });
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
    jest.spyOn(privateService(), 'isInstalled').mockResolvedValue(true);
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
    jest.spyOn(privateService(), 'readWireGuardDump').mockResolvedValue(new Map([
      ['active-key', { publicKey: 'active-key', lastHandshakeEpoch: 1777283940, bytesReceived: 10, bytesSent: 20 }],
      ['idle-key', { publicKey: 'idle-key', lastHandshakeEpoch: 1777283580, bytesReceived: 10, bytesSent: 20 }],
      ['offline-key', { publicKey: 'offline-key', lastHandshakeEpoch: 1777283000, bytesReceived: 10, bytesSent: 20 }],
    ]));

    const result = await service.listPeers();

    expect(result.map((peer) => peer.status)).toEqual(['active', 'idle', 'offline']);
  });

  it('POST /vpn/peers fails clearly when VPN is not installed', async () => {
    jest.spyOn(privateService(), 'isInstalled').mockResolvedValue(false);

    await expect(service.createPeer('Alice')).rejects.toThrow(BadRequestException);
  });

  it('GET /vpn/relay-guide shows the stored Callytics relay public key and UFW safety explanation', async () => {
    process.env.VPN_PUBLIC_IP = '198.51.100.99';
    process.env.HOST_IP = '192.168.1.10';
    jest.spyOn(privateService(), 'ensureRelayKeyPair').mockResolvedValue({
      privateKey: 'private-key',
      publicKey: 'public-key',
    });
    jest.spyOn(service, 'getRelayConfig').mockResolvedValue({
      config: null,
      vpsPublicKey: null,
      vpsPublicIp: '198.51.100.20',
    });

    const result = await service.getRelayGuide();

    const step4 = result.data.find((step) => step.stepNumber === 4);
    const step5 = result.data.find((step) => step.stepNumber === 5);
    const step7 = result.data.find((step) => step.stepNumber === 7);
    const step8 = result.data.find((step) => step.stepNumber === 8);
    const step9 = result.data.find((step) => step.stepNumber === 9);
    expect(step4?.commands[0]?.explanation).toContain('WireGuard ignores unauthenticated packets');
    expect(step5?.commands[0]?.command).toContain('CALLYTICS_ENDPOINT="198.51.100.99:51820"');
    expect(step5?.commands[0]?.command).toContain('CALLYTICS_PUBLIC_KEY="public-key"');
    expect(step5?.commands[0]?.command).not.toContain('unavailable until WireGuard is running');
    expect(step7?.commands[0]?.command).toContain('PublicKey = public-key');
    expect(step7?.commands[0]?.command).toContain('Endpoint = 198.51.100.99:51820');
    expect(step7?.explanation).toContain('callytics-relay');
    expect(step7?.commands[1]?.verificationExpected).toContain('callytics-relay');
    expect(step8?.commands[0]?.command).toBe('ping -c 4 10.8.0.1');
    expect(step9?.values?.find((value) => value.label === 'SIP server')?.value).toBe('198.51.100.20');
  });

  it('POST /vpn/relay-config reuses the stored Callytics relay keypair', async () => {
    jest.spyOn(privateService(), 'ensureRelayKeyPair').mockResolvedValue({
      privateKey: 'stored-private-key',
      publicKey: 'stored-public-key',
    });
    const generateKeyPair = jest.spyOn(privateService(), 'generateKeyPair');

    const result = await service.createRelayConfig('vps-public-key', '203.0.113.20');

    expect(result.config).toContain('PrivateKey = stored-private-key');
    expect(result.config).toContain('PublicKey = vps-public-key');
    expect(result.config).toContain('Endpoint = 203.0.113.20:51820');
    expect(result.config).toContain('DNS = 1.1.1.1');
    expect(result.config).toContain('PostUp = sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true; iptables -t nat -A PREROUTING -i callytics-relay -p udp --dport 5080 -j DNAT --to-destination 172.20.0.1:5080');
    expect(result.config).toContain('iptables -t nat -A PREROUTING -i callytics-relay -p udp --dport 10000:20000 -j DNAT --to-destination 172.20.0.1');
    expect(result.config).toContain('iptables -t nat -A POSTROUTING -o eth+ -p udp --dport 5080 -j SNAT --to-source 10.8.0.1');
    expect(result.config).toContain('iptables -t nat -A POSTROUTING -o eth+ -p udp --dport 10000:20000 -j MASQUERADE');
    expect(result.config).toContain('PostDown = sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true; iptables -t nat -D PREROUTING -i callytics-relay -p udp --dport 5080 -j DNAT --to-destination 172.20.0.1:5080');
    expect(result.config).toContain('iptables -t nat -D POSTROUTING -o eth+ -p udp --dport 5080 -j SNAT --to-source 10.8.0.1');
    expect(generateKeyPair).not.toHaveBeenCalled();
  });

  it('POST /vpn/relay-activate writes config, applies host networking, and syncs pjsip transport', async () => {
    jest.spyOn(service as unknown as { isWireGuardContainerRunning: () => Promise<boolean> }, 'isWireGuardContainerRunning')
      .mockResolvedValue(false);
    jest.spyOn(service as unknown as { clearRelayContainerBeforeCreate: () => Promise<void> }, 'clearRelayContainerBeforeCreate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { createRelayContainer: () => Promise<void> }, 'createRelayContainer')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { startRelayContainer: () => Promise<void> }, 'startRelayContainer')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as {
      getRelayContainerNetworkState: () => Promise<{ bridgeInterface: string; relayBridgeIp: string }>;
    }, 'getRelayContainerNetworkState').mockResolvedValue({
      bridgeInterface: 'br-cc7763721598',
      relayBridgeIp: '172.20.0.3',
    });
    jest.spyOn(service as unknown as {
      applyRelayHostNetworking: (state: { bridgeInterface: string; relayBridgeIp: string }) => Promise<void>;
    }, 'applyRelayHostNetworking').mockResolvedValue(undefined);
    const writeRelayActiveFlag = jest.spyOn(service as unknown as { writeRelayActiveFlag: (active: boolean) => Promise<void> }, 'writeRelayActiveFlag')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { syncRelayPjsipTransport: () => Promise<void> }, 'syncRelayPjsipTransport')
      .mockResolvedValue(undefined);

    await service.activateRelayTunnel('[Interface]\nPrivateKey = abc');

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/wg_confs/callytics-relay.conf'),
      '[Interface]\nPrivateKey = abc\n',
      expect.objectContaining({ encoding: 'utf8', mode: 0o600 }),
    );
    expect(writeRelayActiveFlag).toHaveBeenCalledWith(true);
  });

  it('POST /vpn/relay-activate blocks when built-in VPN is active with peers', async () => {
    jest.spyOn(service as unknown as { isWireGuardContainerRunning: () => Promise<boolean> }, 'isWireGuardContainerRunning')
      .mockResolvedValue(true);
    jest.spyOn(privateService(), 'readWireGuardDump').mockResolvedValue(new Map([
      ['peer-key', { publicKey: 'peer-key', lastHandshakeEpoch: 1777283940, bytesReceived: 1, bytesSent: 1 }],
    ]));

    await expect(service.activateRelayTunnel('[Interface]\nPrivateKey = abc')).rejects.toThrow('Cannot activate relay');
  });

  it('GET /vpn/relay-status reports active and handshake when relay container is running', async () => {
    jest.spyOn(service as unknown as { readRelayActiveFlag: () => Promise<boolean> }, 'readRelayActiveFlag').mockResolvedValue(true);
    jest.spyOn(service as unknown as { isRelayContainerRunning: () => Promise<boolean> }, 'isRelayContainerRunning').mockResolvedValue(true);
    jest.spyOn(service as unknown as { isRelayHandshakeEstablished: () => Promise<boolean> }, 'isRelayHandshakeEstablished').mockResolvedValue(true);

    await expect(service.getRelayStatus()).resolves.toEqual({ active: true, handshakeEstablished: true });
  });

  it('DELETE /vpn/relay-deactivate removes host networking, clears active flag, and syncs pjsip transport', async () => {
    jest.spyOn(service as unknown as {
      getRelayContainerNetworkState: () => Promise<{ bridgeInterface: string; relayBridgeIp: string }>;
    }, 'getRelayContainerNetworkState').mockResolvedValue({
      bridgeInterface: 'br-cc7763721598',
      relayBridgeIp: '172.20.0.3',
    });
    jest.spyOn(service as unknown as {
      removeRelayHostNetworking: (state: { bridgeInterface: string; relayBridgeIp: string }) => Promise<void>;
    }, 'removeRelayHostNetworking').mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { stopRelayContainerIfRunning: () => Promise<void> }, 'stopRelayContainerIfRunning')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { removeRelayContainerIfExists: () => Promise<void> }, 'removeRelayContainerIfExists')
      .mockResolvedValue(undefined);
    const writeRelayActiveFlag = jest.spyOn(service as unknown as { writeRelayActiveFlag: (active: boolean) => Promise<void> }, 'writeRelayActiveFlag')
      .mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { syncRelayPjsipTransport: () => Promise<void> }, 'syncRelayPjsipTransport')
      .mockResolvedValue(undefined);

    await service.deactivateRelayTunnel();

    expect(writeRelayActiveFlag).toHaveBeenCalledWith(false);
  });

  it('syncRelayPjsipTransport uses the stored VPS IP when relay is active', async () => {
    jest.spyOn(service, 'getRelayStatus').mockResolvedValue({ active: true, handshakeEstablished: true });
    jest.spyOn(service, 'getRelayConfig').mockResolvedValue({
      config: '[Peer]\nEndpoint = 203.0.113.10:51820\n',
      vpsPublicKey: 'vps-public-key',
      vpsPublicIp: '203.0.113.10',
    });

    await (service as unknown as { syncRelayPjsipTransport: () => Promise<void> }).syncRelayPjsipTransport();

    expect(mockAsteriskConfigService.syncUdpTransport).toHaveBeenCalledWith('203.0.113.10');
    expect(mockAsteriskConfigService.syncExtensionsRelayConfig).not.toHaveBeenCalled();
  });

  it('syncRelayPjsipTransport clears relay external addresses when relay is inactive', async () => {
    jest.spyOn(service, 'getRelayStatus').mockResolvedValue({ active: false, handshakeEstablished: false });

    await (service as unknown as { syncRelayPjsipTransport: () => Promise<void> }).syncRelayPjsipTransport();

    expect(mockAsteriskConfigService.syncUdpTransport).toHaveBeenCalledWith(null);
    expect(mockAsteriskConfigService.syncExtensionsRelayConfig).not.toHaveBeenCalled();
  });

  it('GET /vpn/relay-config returns stored config with parsed VPS key and IP', async () => {
    (fs.promises.readFile as jest.Mock).mockResolvedValue(
      '[Interface]\nPrivateKey = stored-private-key\nAddress = 10.8.0.1/24\n\n[Peer]\nPublicKey = vps-public-key\nEndpoint = 203.0.113.10:51820\nAllowedIPs = 10.8.0.0/24\n',
    );

    await expect(service.getRelayConfig()).resolves.toEqual({
      config: expect.stringContaining('PrivateKey = stored-private-key'),
      vpsPublicKey: 'vps-public-key',
      vpsPublicIp: '203.0.113.10',
    });
  });
});
