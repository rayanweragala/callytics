import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleInit, forwardRef } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as http from 'node:http';
import * as net from 'node:net';
import { execFile } from 'node:child_process';
import { join, relative } from 'node:path';
import QRCode from 'qrcode';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { VpnPeerEntity } from './entities/vpn-peer.entity';
import type {
  CreatedVpnPeerResponse,
  RelayGuideStep,
  RelayConfigResponse,
  RelayTunnelStatusResponse,
  VpnPeerResponse,
  VpnPeerStatus,
  VpnStatusResponse,
} from './vpn.types';

const VPN_SUBNET = '10.8.0.0/24';
const VPN_PREFIX = '10.8.0.';
const VPN_SERVER_IP = '10.8.0.1';
const WIREGUARD_INTERFACE = 'wg0';
const RELAY_INTERFACE = 'callytics-relay';
const RELAY_CONTAINER = 'callytics-relay';
const RELAY_IMAGE = 'linuxserver/wireguard';
const RELAY_NETWORK = 'callytics_default';
const WIREGUARD_PORT = 51820;
const WIREGUARD_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const RTP_PORT_RANGE = '10000:20000';
const RELAY_BRIDGE_GATEWAY_IP = '172.20.0.1';
const RELAY_HOST_ROUTE_SUBNET = '10.8.0.0/24';
const RELAY_HOST_UDP_PORT = '5080';
const HOST_HELPER_IMAGE = 'alpine';

interface WireGuardPeerDump {
  publicKey: string;
  lastHandshakeEpoch: number;
  bytesReceived: number;
  bytesSent: number;
}

interface DockerContainerStatus {
  Id?: string;
  Mounts?: DockerMount[];
  Names?: string[];
  State?: string;
}

interface DockerMount {
  Source?: string;
  Destination?: string;
}

interface DockerContainerInspect {
  State?: { Running?: boolean };
  NetworkSettings?: {
    Networks?: Record<string, DockerNetworkEndpoint | undefined>;
  };
}

interface DockerNetworkEndpoint {
  NetworkID?: string;
  IPAddress?: string;
}

interface DockerNetworkInspect {
  Id?: string;
  Options?: Record<string, string | undefined>;
}

interface ServerPublicKeyResult {
  value: string | null;
  error: string | null;
}

@Injectable()
export class VpnService implements OnModuleInit {
  private readonly configDir = process.env.WIREGUARD_CONFIG_DIR || join(process.cwd(), '..', 'wireguard-config');
  private readonly wireGuardContainer = 'callytics-wireguard-1';
  private readonly relayPrivateKeyPath = join(this.configDir, 'relay-callytics-private.key');
  private readonly relayPublicKeyPath = join(this.configDir, 'relay-callytics-public.key');
  private readonly relayRuntimeDir = join(this.configDir, 'relay-runtime');
  private readonly relayConfigPath = join(this.relayRuntimeDir, 'wg_confs', `${RELAY_INTERFACE}.conf`);
  private readonly legacyRelayConfigPath = join(this.relayRuntimeDir, 'wg_confs', 'wg0.conf');
  private readonly relayStatePath = join(this.configDir, 'relay-state.json');
  private cachedPublicIp: string | null = null;
  private cachedPublicIpAt = 0;

  constructor(
    @InjectRepository(VpnPeerEntity)
    private readonly peersRepository: Repository<VpnPeerEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(forwardRef(() => AsteriskConfigService))
    private readonly asteriskConfigService: AsteriskConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
  }

  async getStatus(): Promise<VpnStatusResponse> {
    try {
      const runtimeState = await this.detectWireGuardRuntime();
      if (!runtimeState.installed) {
        return {
          installed: false,
          running: null,
          serverPublicKey: null,
          serverPublicKeyError: null,
          endpoint: null,
          subnet: null,
          peerCount: 0,
          subnetConflict: false,
          subnetConflictDetail: null,
        };
      }

      const [serverPublicKeyResult, dump, conflict, endpointHost] = await Promise.all([
        this.getServerPublicKeyWithFallback(),
        this.readWireGuardDump(),
        Promise.resolve(this.detectSubnetConflict()),
        this.getPublicEndpointHost(),
      ]);

      return {
        installed: true,
        running: runtimeState.running,
        serverPublicKey: serverPublicKeyResult.value,
        serverPublicKeyError: serverPublicKeyResult.error,
        endpoint: `${endpointHost}:${WIREGUARD_PORT}`,
        subnet: VPN_SUBNET,
        peerCount: dump.size,
        subnetConflict: conflict.conflict,
        subnetConflictDetail: conflict.detail,
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to read VPN status');
    }
  }

  async listPeers(): Promise<VpnPeerResponse[]> {
    try {
      const [peers, dump] = await Promise.all([
        this.peersRepository.find({
          where: { revokedAt: IsNull() },
          order: { createdAt: 'DESC', id: 'DESC' },
        }),
        this.readWireGuardDump(),
      ]);

      return peers.map((peer) => this.toPeerResponse(peer, dump.get(peer.publicKey) || null));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to load VPN peers');
    }
  }

  async createPeer(name: string): Promise<{ data: CreatedVpnPeerResponse }> {
    try {
      await this.requireInstalled();
      const normalizedName = this.normalizePeerName(name);
      const assignedIp = await this.nextAvailableIp();
      const keyPair = await this.generateKeyPair();

      const entity = this.peersRepository.create({
        name: normalizedName,
        assignedIp,
        publicKey: keyPair.publicKey,
        // Known limitation: VPN private keys are stored plaintext until a project-wide encryption helper exists.
        privateKey: keyPair.privateKey,
      });
      const saved = await this.peersRepository.save(entity);

      await this.addLivePeer(saved);
      const config = await this.buildPeerConfig(saved);
      await this.writePeerConfig(saved, config);

      return {
        data: {
          ...this.toPeerResponse(saved, null),
          privateKey: saved.privateKey,
          config,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to create VPN peer');
    }
  }

  async getPeerConfig(id: number): Promise<string> {
    try {
      const peer = await this.requirePeer(id);
      return this.buildPeerConfig(peer);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to build peer config');
    }
  }

  async getPeerQr(id: number): Promise<Buffer> {
    try {
      const config = await this.getPeerConfig(id);
      return QRCode.toBuffer(config, { type: 'png', width: 320, margin: 1 });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to generate VPN QR code');
    }
  }

  async revokePeer(id: number): Promise<void> {
    try {
      const peer = await this.requirePeer(id);
      await this.removeLivePeer(peer.publicKey);
      peer.revokedAt = new Date();
      await this.peersRepository.save(peer);
      await this.removePeerConfig(peer);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to revoke VPN peer');
    }
  }

  async removeVpn(): Promise<{ success: true }> {
    try {
      const stopResponse = await this.dockerSocketRequest({
        method: 'POST',
        path: `/containers/${this.wireGuardContainer}/stop`,
      });
      if (!this.isSuccessStatus(stopResponse.statusCode) && stopResponse.statusCode !== 304 && stopResponse.statusCode !== 404) {
        throw new Error(`Docker stop failed (${stopResponse.statusCode ?? 'unknown'}): ${stopResponse.body.toString('utf8')}`);
      }

      const removeResponse = await this.dockerSocketRequest({
        method: 'POST',
        path: `/containers/${this.wireGuardContainer}/remove`,
      });

      if (!this.isSuccessStatus(removeResponse.statusCode) && removeResponse.statusCode !== 404) {
        const fallbackRemove = await this.dockerSocketRequest({
          method: 'DELETE',
          path: `/containers/${this.wireGuardContainer}?force=1`,
        });
        if (!this.isSuccessStatus(fallbackRemove.statusCode) && fallbackRemove.statusCode !== 404) {
          throw new Error(`Docker remove failed (${fallbackRemove.statusCode ?? 'unknown'}): ${fallbackRemove.body.toString('utf8')}`);
        }
      }

      return { success: true };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to remove WireGuard container');
    }
  }

  async getRelayGuide(): Promise<{ data: RelayGuideStep[] }> {
    try {
      const serverKeyPair = await this.ensureRelayKeyPair();
      const publicEndpointHost = this.getRelayGuideEndpointHost();
      const endpoint = `${publicEndpointHost}:${WIREGUARD_PORT}`;
      const relayConfig = await this.getRelayConfig();
      const vpsPublicIp = relayConfig.vpsPublicIp || '<VPS_PUBLIC_IP>';
      const callyticsEndpointHost = publicEndpointHost;
      return {
        data: [
          {
            stepNumber: 1,
            title: 'Install WireGuard on the VPS',
            explanation: 'Prepare a small public VPS to relay softphone traffic back to this server over WireGuard.',
            commands: [
              {
                command: 'sudo apt update && sudo apt install -y wireguard',
                explanation: 'Installs the WireGuard userspace tools and service files.',
                verification: 'wg --version',
                verificationExpected: 'You should see a WireGuard version string.',
              },
            ],
          },
          {
            stepNumber: 2,
            title: 'Create the VPS keys',
            explanation: 'Generate a private key for the VPS and derive its public key.',
            commands: [
              {
                command: 'wg genkey | tee vps-private.key | wg pubkey > vps-public.key',
                explanation: 'Keeps the private key on the VPS and writes the public key for Callytics.',
                verification: 'cat vps-public.key',
                verificationExpected: 'You should see one base64 WireGuard public key.',
              },
            ],
          },
          {
            stepNumber: 3,
            title: 'Enable packet forwarding',
            explanation: 'The VPS must forward packets between remote phones and the Callytics VPN peer.',
            commands: [
              {
                command: "echo 'net.ipv4.ip_forward=1' | sudo tee /etc/sysctl.d/99-callytics-vpn.conf && sudo sysctl --system",
                explanation: 'Enables IPv4 forwarding persistently.',
                verification: 'sysctl net.ipv4.ip_forward',
                verificationExpected: 'You should see net.ipv4.ip_forward = 1.',
              },
            ],
          },
          {
            stepNumber: 4,
            title: 'Open the WireGuard UDP port',
            explanation: 'Remote softphones must reach UDP 51820 on the VPS.',
            commands: [
              {
                command: 'sudo ufw allow 51820/udp',
                explanation: 'Allows WireGuard traffic through UFW when UFW is enabled. This is safe because WireGuard ignores unauthenticated packets: scanners and attackers get no response, so opening this UDP port does not create meaningful attack surface.',
                verification: 'sudo ufw status',
                verificationExpected: 'You should see 51820/udp listed as allowed.',
              },
            ],
          },
          {
            stepNumber: 5,
            title: 'Connect the VPS to Callytics',
            explanation: 'Use the Callytics server public key and endpoint when creating the VPS peer.',
            commands: [
              {
                command: `CALLYTICS_ENDPOINT="${endpoint}"\nCALLYTICS_PUBLIC_KEY="${serverKeyPair.publicKey}"`,
                explanation: 'These values identify this Callytics server from the VPS.',
                verification: null,
                verificationExpected: null,
              },
            ],
          },
          {
            stepNumber: 6,
            title: 'Generate the Callytics-side peer config',
            explanation: 'Enter the VPS public key and public IP below. Callytics will return the peer config to install locally.',
            commands: [],
          },
          {
            stepNumber: 7,
            title: 'Configure WireGuard on the VPS',
            explanation: 'Create the WireGuard config file on the VPS. Replace <YOUR_VPS_PRIVATE_KEY> with the private key you generated in Step 2. Callytics will create and manage the relay-side callytics-relay interface automatically when you activate the relay.',
            commands: [
              {
                command: [
                  '[Interface]',
                  'PrivateKey = <YOUR_VPS_PRIVATE_KEY>',
                  'Address = 10.8.0.2/24',
                  'ListenPort = 51820',
                  '',
                  '[Peer]',
                  `PublicKey = ${serverKeyPair.publicKey}`,
                  `Endpoint = ${callyticsEndpointHost}:${WIREGUARD_PORT}`,
                  `AllowedIPs = ${VPN_SUBNET}`,
                  'PersistentKeepalive = 25',
                ].join('\n'),
                explanation: 'Copy this into the VPS WireGuard config (for example, /etc/wireguard/wg0.conf).',
                verification: null,
                verificationExpected: null,
              },
              {
                command: 'sudo wg-quick up wg0',
                explanation: 'Starts the VPS WireGuard interface with the config above.',
                verification: 'sudo wg show',
                verificationExpected: 'You should see the Callytics peer listed. The handshake with the callytics-relay side will appear once both sides are up.',
              },
            ],
          },
          {
            stepNumber: 8,
            title: 'Verify the tunnel is up',
            explanation: 'Confirm the VPS can reach Callytics over the WireGuard tunnel. In the Callytics VPN page, the External Relay card should show VPS connected instead of Awaiting VPS handshake once the handshake completes.',
            commands: [
              {
                command: 'ping -c 4 10.8.0.1',
                explanation: 'Run this on the VPS to verify L3 connectivity over the WireGuard tunnel.',
                verification: null,
                verificationExpected: 'You should see replies from 10.8.0.1 with no packet loss. If this fails, check that both WireGuard configs have the correct public keys and that UDP 51820 is open on the VPS.',
              },
            ],
          },
          {
            stepNumber: 9,
            title: 'Connect your softphone',
            explanation: 'Your softphone must register to Callytics using the VPS public IP as the SIP server address. The VPS relays traffic through the tunnel to Callytics. Use your extension number and password from the Extensions page. After registering, the extension should show as online in Callytics. Make a test call. Audio should work in both directions.',
            commands: [],
            values: [
              { label: 'SIP server', value: vpsPublicIp },
              { label: 'Port', value: '5080' },
              { label: 'Transport', value: 'UDP' },
            ],
          },
        ],
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to build relay guide');
    }
  }

  async createRelayConfig(vpsPublicKey: string, vpsPublicIp: string): Promise<{ config: string }> {
    try {
      const publicKey = vpsPublicKey.trim();
      const publicIp = vpsPublicIp.trim();
      if (!publicKey || !publicIp) {
        throw new BadRequestException('VPS public key and public IP are required');
      }
      const keyPair = await this.ensureRelayKeyPair();
      return {
        config: [
          '[Interface]',
          `PrivateKey = ${keyPair.privateKey}`,
          `Address = ${VPN_SERVER_IP}/24`,
          'DNS = 1.1.1.1',
          `PostUp = sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true; iptables -t nat -A PREROUTING -i ${RELAY_INTERFACE} -p udp --dport ${RELAY_HOST_UDP_PORT} -j DNAT --to-destination ${RELAY_BRIDGE_GATEWAY_IP}:${RELAY_HOST_UDP_PORT}; iptables -t nat -A PREROUTING -i ${RELAY_INTERFACE} -p udp --dport ${RTP_PORT_RANGE} -j DNAT --to-destination ${RELAY_BRIDGE_GATEWAY_IP}; iptables -t nat -A POSTROUTING -o eth+ -p udp --dport ${RELAY_HOST_UDP_PORT} -j SNAT --to-source ${VPN_SERVER_IP}; iptables -t nat -A POSTROUTING -o eth+ -p udp --dport ${RTP_PORT_RANGE} -j MASQUERADE`,
          `PostDown = sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1 || true; iptables -t nat -D PREROUTING -i ${RELAY_INTERFACE} -p udp --dport ${RELAY_HOST_UDP_PORT} -j DNAT --to-destination ${RELAY_BRIDGE_GATEWAY_IP}:${RELAY_HOST_UDP_PORT}; iptables -t nat -D PREROUTING -i ${RELAY_INTERFACE} -p udp --dport ${RTP_PORT_RANGE} -j DNAT --to-destination ${RELAY_BRIDGE_GATEWAY_IP}; iptables -t nat -D POSTROUTING -o eth+ -p udp --dport ${RELAY_HOST_UDP_PORT} -j SNAT --to-source ${VPN_SERVER_IP}; iptables -t nat -D POSTROUTING -o eth+ -p udp --dport ${RTP_PORT_RANGE} -j MASQUERADE`,
          '',
          '[Peer]',
          `PublicKey = ${publicKey}`,
          `Endpoint = ${publicIp}:${WIREGUARD_PORT}`,
          `AllowedIPs = ${VPN_SUBNET}`,
          'PersistentKeepalive = 25',
          '',
        ].join('\n'),
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to create relay config');
    }
  }

  async getRelayConfig(): Promise<RelayConfigResponse> {
    try {
      const config = await this.readStoredRelayConfig();
      return this.parseRelayConfig(config);
    } catch {
      return {
        config: null,
        vpsPublicKey: null,
        vpsPublicIp: null,
      };
    }
  }

  async activateRelayTunnel(config: string): Promise<{ success: true }> {
    try {
      const normalizedConfig = config.trim();
      if (!normalizedConfig) {
        throw new BadRequestException('Relay config is required');
      }
      await this.ensureRelayConflictFree();
      await fs.promises.mkdir(join(this.relayRuntimeDir, 'wg_confs'), { recursive: true });
      await this.removeLegacyRelayConfigIfPresent();
      await fs.promises.writeFile(this.relayConfigPath, `${normalizedConfig}\n`, { encoding: 'utf8', mode: 0o600 });
      const relayConfig = this.parseRelayConfig(normalizedConfig);
      await this.clearRelayContainerBeforeCreate();
      await this.createRelayContainer();
      await this.startRelayContainer();
      const relayNetworkState = await this.getRelayContainerNetworkState();
      await this.applyRelayHostNetworking(relayNetworkState);
      await this.writeRelayActiveFlag(true, relayConfig.vpsPublicIp);
      await this.syncRelayPjsipTransport();
      await this.syncRelayExtensionsConfig();
      return { success: true };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to activate relay tunnel');
    }
  }

  async deactivateRelayTunnel(): Promise<{ success: true }> {
    try {
      const relayNetworkState = await this.getRelayContainerNetworkState().catch(() => null);
      if (relayNetworkState) {
        await this.removeRelayHostNetworking(relayNetworkState);
      }
      await this.stopRelayContainerIfRunning();
      await this.removeRelayContainerIfExists();
      await this.writeRelayActiveFlag(false, null);
      await this.syncRelayPjsipTransport();
      await this.syncRelayExtensionsConfig();
      return { success: true };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Failed to deactivate relay tunnel');
    }
  }

  async getRelayStatus(): Promise<RelayTunnelStatusResponse> {
    const persistedState = await this.readRelayState();
    const active = persistedState.active && await this.isRelayContainerRunning();
    const handshakeEstablished = active ? await this.isRelayHandshakeEstablished() : false;
    let vpsPublicIp = active ? persistedState.vpsPublicIp : null;
    if (active && !vpsPublicIp) {
      const relayConfig = await this.getRelayConfig();
      vpsPublicIp = relayConfig.vpsPublicIp || null;
      if (vpsPublicIp) {
        await this.writeRelayActiveFlag(true, vpsPublicIp);
      }
    }
    return {
      active,
      handshakeEstablished,
      vpsPublicIp,
    };
  }

  async isInstalled(): Promise<boolean> {
    try {
      const runtimeState = await this.detectWireGuardRuntime();
      return runtimeState.installed;
    } catch {
      return false;
    }
  }

  private async requireInstalled(): Promise<void> {
    const installed = await this.isInstalled();
    if (!installed) {
      throw new BadRequestException('VPN is not installed. Enable WireGuard before restricting extensions to VPN-only.');
    }
  }

  private async hasWireGuardInterface(): Promise<boolean> {
    try {
      await this.runHostCommand('ip', ['link', 'show', WIREGUARD_INTERFACE]);
      return true;
    } catch {
      return false;
    }
  }

  private async isWireGuardContainerRunning(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: '/var/run/docker.sock',
        host: 'localhost',
        path: '/containers/json',
        method: 'GET',
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`docker socket returned ${response.statusCode ?? 'unknown status'}`));
            return;
          }

          try {
            const containers = JSON.parse(body) as DockerContainerStatus[];
            const isRunning = containers.some((container) => {
              const names = Array.isArray(container.Names) ? container.Names : [];
              const hasWireGuardName = names.some((name) => name.toLowerCase().includes('wireguard'));
              return hasWireGuardName && container.State === 'running';
            });
            resolve(isRunning);
          } catch (error) {
            reject(error instanceof Error ? error : new Error('failed to parse docker container list'));
          }
        });
      });

      request.on('error', reject);
      request.end();
    });
  }

  private async detectWireGuardRuntime(): Promise<{ installed: boolean; running: boolean }> {
    let containerRunning = false;
    try {
      containerRunning = await this.isWireGuardContainerRunning();
    } catch {
      containerRunning = false;
    }

    let interfaceRunning = false;
    try {
      interfaceRunning = await this.hasWireGuardInterface();
    } catch {
      interfaceRunning = false;
    }

    const running = containerRunning || interfaceRunning;
    return { installed: running, running };
  }

  private async readWireGuardDump(): Promise<Map<string, WireGuardPeerDump>> {
    try {
      const output = await this.execInWireguard(['wg', 'show', WIREGUARD_INTERFACE, 'dump']);
      const lines = output.split(/\r?\n/).filter(Boolean).slice(1);
      const peers = new Map<string, WireGuardPeerDump>();
      for (const line of lines) {
        const parts = line.split('\t');
        const publicKey = parts[0] || '';
        if (!publicKey) {
          continue;
        }
        peers.set(publicKey, {
          publicKey,
          lastHandshakeEpoch: Number(parts[4] || 0),
          bytesReceived: Number(parts[5] || 0),
          bytesSent: Number(parts[6] || 0),
        });
      }
      return peers;
    } catch {
      return new Map();
    }
  }

  private async ensureRelayConflictFree(): Promise<void> {
    const builtInRunning = await this.isWireGuardContainerRunning();
    if (!builtInRunning) {
      return;
    }
    const dump = await this.readWireGuardDump();
    if (dump.size > 0) {
      throw new ConflictException('Cannot activate relay - built-in VPN is currently active. Disable it first.');
    }
  }

  private async isRelayHandshakeEstablished(): Promise<boolean> {
    try {
      const output = await this.execInContainer(RELAY_CONTAINER, ['wg', 'show', RELAY_INTERFACE, 'latest-handshakes']);
      if (!output) {
        return false;
      }
      return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .some((line) => {
          const parts = line.split(/\s+/);
          const handshake = Number(parts[1] || 0);
          return Number.isFinite(handshake) && handshake > 0;
        });
    } catch {
      return false;
    }
  }

  private async isRelayContainerRunning(): Promise<boolean> {
    try {
      const response = await this.dockerSocketRequest({
        method: 'GET',
        path: `/containers/${RELAY_CONTAINER}/json`,
      });
      if (response.statusCode === 404) {
        return false;
      }
      if (!this.isSuccessStatus(response.statusCode)) {
        return false;
      }
      const payload = this.parseJson<DockerContainerInspect>(response.body, 'Docker relay inspect response');
      return payload.State?.Running === true;
    } catch {
      return false;
    }
  }

  private async createRelayContainer(): Promise<void> {
    const relayBindSource = await this.resolveRelayRuntimeBindSource();
    const response = await this.dockerSocketRequest({
      method: 'POST',
      path: `/containers/create?name=${encodeURIComponent(RELAY_CONTAINER)}`,
      body: {
        Image: RELAY_IMAGE,
        Env: [
          `PUID=${process.env.PUID || '1000'}`,
          `PGID=${process.env.PGID || '1000'}`,
          `TZ=${process.env.TZ || 'UTC'}`,
        ],
        HostConfig: {
          NetworkMode: RELAY_NETWORK,
          CapAdd: ['NET_ADMIN', 'SYS_MODULE'],
          Binds: [`${relayBindSource}:/config`],
          Sysctls: {
            'net.ipv4.ip_forward': '1',
          },
          PortBindings: {
            '51820/udp': [{ HostPort: '51820' }],
          },
          RestartPolicy: { Name: 'unless-stopped' },
        },
        ExposedPorts: {
          '51820/udp': {},
        },
      },
    });
    if (!this.isSuccessStatus(response.statusCode)) {
      throw new Error(`Failed to create relay container (${response.statusCode ?? 'unknown'}): ${response.body.toString('utf8')}`);
    }
  }

  private async resolveRelayRuntimeBindSource(): Promise<string> {
    try {
      const response = await this.dockerSocketRequest({
        method: 'GET',
        path: '/containers/json',
      });
      if (!this.isSuccessStatus(response.statusCode)) {
        return this.relayRuntimeDir;
      }

      const containers = this.parseJson<DockerContainerStatus[]>(response.body, 'Docker container list response');
      const matchingMount = containers
        .flatMap((container) => container.Mounts || [])
        .find((mount) => {
          if (!mount.Source || !mount.Destination) {
            return false;
          }
          return this.configDir === mount.Destination || this.configDir.startsWith(`${mount.Destination}/`);
        });
      if (!matchingMount?.Source || !matchingMount.Destination) {
        return this.relayRuntimeDir;
      }

      const relayRelativePath = relative(matchingMount.Destination, this.relayRuntimeDir);
      return join(matchingMount.Source, relayRelativePath);
    } catch {
      return this.relayRuntimeDir;
    }
  }

  private async startRelayContainer(): Promise<void> {
    const response = await this.dockerSocketRequest({
      method: 'POST',
      path: `/containers/${RELAY_CONTAINER}/start`,
    });
    if (response.statusCode !== 304 && !this.isSuccessStatus(response.statusCode)) {
      throw new Error(`Failed to start relay container (${response.statusCode ?? 'unknown'}): ${response.body.toString('utf8')}`);
    }
  }

  private async stopRelayContainerIfRunning(): Promise<void> {
    const response = await this.dockerSocketRequest({
      method: 'POST',
      path: `/containers/${RELAY_CONTAINER}/stop`,
    });
    if (response.statusCode === 304 || response.statusCode === 404 || this.isSuccessStatus(response.statusCode)) {
      return;
    }
    throw new Error(`Failed to stop relay container (${response.statusCode ?? 'unknown'}): ${response.body.toString('utf8')}`);
  }

  private async removeRelayContainerIfExists(): Promise<void> {
    await this.removeContainerIfExists(RELAY_CONTAINER);
  }

  private async clearRelayContainerBeforeCreate(): Promise<void> {
    const response = await this.dockerSocketRequest({
      method: 'DELETE',
      path: `/containers/${RELAY_CONTAINER}?force=1`,
    });
    if (response.statusCode === 404 || this.isSuccessStatus(response.statusCode)) {
      return;
    }
    throw new Error(`Failed to clear relay container before create (${response.statusCode ?? 'unknown'}): ${response.body.toString('utf8')}`);
  }

  private async removeContainerIfExists(containerName: string): Promise<void> {
    const removeResponse = await this.dockerSocketRequest({
      method: 'POST',
      path: `/containers/${containerName}/remove`,
    });

    if (removeResponse.statusCode === 404 || this.isSuccessStatus(removeResponse.statusCode)) {
      return;
    }

    const fallbackRemove = await this.dockerSocketRequest({
      method: 'DELETE',
      path: `/containers/${containerName}?force=1`,
    });
    if (fallbackRemove.statusCode === 404 || this.isSuccessStatus(fallbackRemove.statusCode)) {
      return;
    }
    throw new Error(`Failed to remove container ${containerName} (${fallbackRemove.statusCode ?? 'unknown'}): ${fallbackRemove.body.toString('utf8')}`);
  }

  private async writeRelayActiveFlag(active: boolean, vpsPublicIp: string | null): Promise<void> {
    await fs.promises.writeFile(this.relayStatePath, JSON.stringify({ active, vpsPublicIp }), 'utf8');
  }

  private async readRelayState(): Promise<{ active: boolean; vpsPublicIp: string | null }> {
    try {
      const raw = await fs.promises.readFile(this.relayStatePath, 'utf8');
      const parsed = JSON.parse(raw) as { active?: unknown; vpsPublicIp?: unknown };
      return {
        active: parsed.active === true,
        vpsPublicIp: typeof parsed.vpsPublicIp === 'string' && parsed.vpsPublicIp.trim()
          ? parsed.vpsPublicIp.trim()
          : null,
      };
    } catch {
      return { active: false, vpsPublicIp: null };
    }
  }

  private async readStoredRelayConfig(): Promise<string> {
    try {
      return await fs.promises.readFile(this.relayConfigPath, 'utf8');
    } catch {
      return fs.promises.readFile(this.legacyRelayConfigPath, 'utf8');
    }
  }

  private async removeLegacyRelayConfigIfPresent(): Promise<void> {
    try {
      await fs.promises.unlink(this.legacyRelayConfigPath);
    } catch {
      return;
    }
  }

  private parseRelayConfig(config: string): RelayConfigResponse {
    const lines = config.split(/\r?\n/);
    let vpsPublicKey: string | null = null;
    let endpointHost: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const publicKeyMatch = line.match(/^PublicKey\s*=\s*(.+)$/i);
      if (publicKeyMatch?.[1] && !vpsPublicKey) {
        vpsPublicKey = publicKeyMatch[1].trim();
        continue;
      }
      const endpointMatch = line.match(/^Endpoint\s*=\s*(.+)$/i);
      if (endpointMatch?.[1] && !endpointHost) {
        const endpoint = endpointMatch[1].trim();
        const lastColonIndex = endpoint.lastIndexOf(':');
        endpointHost = lastColonIndex > 0 ? endpoint.slice(0, lastColonIndex).trim() : endpoint;
      }
    }

    return {
      config,
      vpsPublicKey: vpsPublicKey || null,
      vpsPublicIp: endpointHost || null,
    };
  }

  private async getServerPublicKeyWithFallback(): Promise<ServerPublicKeyResult> {
    try {
      const value = await this.execInWireguard(['wg', 'show', WIREGUARD_INTERFACE, 'public-key']);
      return { value, error: null };
    } catch (error) {
      return {
        value: null,
        error: this.toErrorMessage(error),
      };
    }
  }

  private async getServerPublicKey(): Promise<string | null> {
    const result = await this.getServerPublicKeyWithFallback();
    return result.value;
  }

  private detectSubnetConflict(): { conflict: boolean; detail: string | null } {
    const interfaces = os.networkInterfaces();
    for (const [name, addresses] of Object.entries(interfaces)) {
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && address.address.startsWith(VPN_PREFIX) && address.address !== VPN_SERVER_IP) {
          return {
            conflict: true,
            detail: `${name} uses ${address.address}, which overlaps ${VPN_SUBNET}.`,
          };
        }
      }
    }
    return { conflict: false, detail: null };
  }

  private async nextAvailableIp(): Promise<string> {
    const peers = await this.peersRepository.find({ select: ['assignedIp'] });
    const used = new Set(peers.map((peer) => String(peer.assignedIp)));
    for (let host = 2; host <= 254; host += 1) {
      const candidate = `${VPN_PREFIX}${host}`;
      if (!used.has(candidate)) {
        return candidate;
      }
    }
    throw new BadRequestException('VPN subnet is full. Revoke an unused peer before adding another.');
  }

  private async generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    try {
      const privateKey = await this.runHostCommand('wg', ['genkey']);
      const publicKey = await this.runHostCommand('wg', ['pubkey'], `${privateKey}\n`);
      return { privateKey, publicKey };
    } catch (error) {
      throw new BadRequestException(`Failed to generate WireGuard keys: ${this.toErrorMessage(error)}`);
    }
  }

  private async ensureRelayKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    const storedKeyPair = await this.readRelayKeyPair();
    if (storedKeyPair) {
      return storedKeyPair;
    }

    const generatedKeyPair = await this.generateKeyPair();
    await fs.promises.mkdir(this.configDir, { recursive: true });
    await Promise.all([
      fs.promises.writeFile(this.relayPrivateKeyPath, `${generatedKeyPair.privateKey}\n`, { encoding: 'utf8', mode: 0o600 }),
      fs.promises.writeFile(this.relayPublicKeyPath, `${generatedKeyPair.publicKey}\n`, { encoding: 'utf8', mode: 0o644 }),
    ]);
    return generatedKeyPair;
  }

  private async readRelayKeyPair(): Promise<{ privateKey: string; publicKey: string } | null> {
    try {
      const [privateKey, publicKey] = await Promise.all([
        fs.promises.readFile(this.relayPrivateKeyPath, 'utf8'),
        fs.promises.readFile(this.relayPublicKeyPath, 'utf8'),
      ]);
      const keyPair = {
        privateKey: privateKey.trim(),
        publicKey: publicKey.trim(),
      };
      if (this.isWireGuardKey(keyPair.privateKey) && this.isWireGuardKey(keyPair.publicKey)) {
        return keyPair;
      }
      return null;
    } catch {
      return null;
    }
  }

  private isWireGuardKey(value: string): boolean {
    return WIREGUARD_KEY_PATTERN.test(value);
  }

  private async addLivePeer(peer: VpnPeerEntity): Promise<void> {
    try {
      await this.execInWireguard([
        'wg',
        'set',
        WIREGUARD_INTERFACE,
        'peer',
        peer.publicKey,
        'allowed-ips',
        `${peer.assignedIp}/32`,
      ]);
    } catch (error) {
      throw new BadRequestException(`Failed to add WireGuard peer: ${this.toErrorMessage(error)}`);
    }
  }

  private async removeLivePeer(publicKey: string): Promise<void> {
    try {
      await this.execInWireguard(['wg', 'set', WIREGUARD_INTERFACE, 'peer', publicKey, 'remove']);
    } catch (error) {
      throw new BadRequestException(`Failed to remove WireGuard peer: ${this.toErrorMessage(error)}`);
    }
  }

  private async buildPeerConfig(peer: VpnPeerEntity): Promise<string> {
    const serverPublicKey = await this.getServerPublicKey();
    if (!serverPublicKey) {
      throw new BadRequestException('WireGuard server public key is unavailable.');
    }
    const endpointHost = await this.getPublicEndpointHost();
    return [
      '[Interface]',
      `PrivateKey = ${peer.privateKey}`,
      `Address = ${peer.assignedIp}/24`,
      'DNS = 1.1.1.1',
      '',
      '[Peer]',
      `PublicKey = ${serverPublicKey}`,
      `Endpoint = ${endpointHost}:${WIREGUARD_PORT}`,
      `AllowedIPs = ${VPN_SUBNET}`,
      'PersistentKeepalive = 25',
      '',
    ].join('\n');
  }

  private async writePeerConfig(peer: VpnPeerEntity, config: string): Promise<void> {
    const peersDir = join(this.configDir, 'peers');
    await fs.promises.mkdir(peersDir, { recursive: true });
    await fs.promises.writeFile(join(peersDir, `${this.safeFileName(peer.name)}.conf`), config, 'utf8');
  }

  private async removePeerConfig(peer: VpnPeerEntity): Promise<void> {
    try {
      await fs.promises.unlink(join(this.configDir, 'peers', `${this.safeFileName(peer.name)}.conf`));
    } catch {
      return;
    }
  }

  private async requirePeer(id: number): Promise<VpnPeerEntity> {
    const peer = await this.peersRepository.findOne({ where: { id, revokedAt: IsNull() } });
    if (!peer) {
      throw new NotFoundException(`VPN peer ${id} not found`);
    }
    return peer;
  }

  private toPeerResponse(peer: VpnPeerEntity, dump: WireGuardPeerDump | null): VpnPeerResponse {
    const lastHandshake = dump && dump.lastHandshakeEpoch > 0
      ? new Date(dump.lastHandshakeEpoch * 1000).toISOString()
      : null;
    return {
      id: peer.id,
      name: peer.name,
      assignedIp: peer.assignedIp,
      publicKey: peer.publicKey,
      status: this.classifyPeerStatus(lastHandshake),
      lastHandshake,
      bytesReceived: dump?.bytesReceived || 0,
      bytesSent: dump?.bytesSent || 0,
      createdAt: peer.createdAt.toISOString(),
    };
  }

  private classifyPeerStatus(lastHandshake: string | null): VpnPeerStatus {
    if (!lastHandshake) {
      return 'offline';
    }
    const ageMs = Date.now() - Date.parse(lastHandshake);
    if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) {
      return 'offline';
    }
    if (ageMs >= 3 * 60 * 1000) {
      return 'idle';
    }
    return 'active';
  }

  private runHostCommand(command: string, args: string[], stdin?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(command, args, { timeout: 8000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      });
      if (stdin !== undefined) {
        child.stdin?.end(stdin);
      }
    });
  }

  private normalizePeerName(name: string): string {
    const normalized = name.trim();
    if (!normalized) {
      throw new BadRequestException('name is required');
    }
    return normalized;
  }

  private safeFileName(name: string): string {
    return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'peer';
  }

  private async detectPublicIp(): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }

      const json = await response.json() as { ip?: unknown };
      if (typeof json.ip === 'string' && net.isIP(json.ip)) {
        return json.ip;
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getPublicEndpointHost(): Promise<string> {
    const now = Date.now();
    if (this.cachedPublicIpAt > 0 && now - this.cachedPublicIpAt < 60_000) {
      return this.cachedPublicIp || this.getEndpointHost();
    }

    const publicIp = await this.detectPublicIp();
    this.cachedPublicIp = publicIp;
    this.cachedPublicIpAt = now;
    return publicIp || this.getEndpointHost();
  }

  private getRelayGuideEndpointHost(): string {
    return process.env.VPN_PUBLIC_IP || '<VPN_PUBLIC_IP>';
  }

  private async syncRelayPjsipTransport(): Promise<void> {
    const relayStatus = await this.getRelayStatus();
    const externalAddress = relayStatus.active ? relayStatus.vpsPublicIp : null;
    await this.asteriskConfigService.syncUdpTransport(externalAddress);
  }

  private async syncRelayExtensionsConfig(): Promise<void> {
    const relayStatus = await this.getRelayStatus();
    const externalAddress = relayStatus.active ? relayStatus.vpsPublicIp : null;
    await this.asteriskConfigService.syncExtensionsRelayConfig(externalAddress);
  }

  private async getRelayContainerNetworkState(): Promise<{
    bridgeInterface: string;
    relayBridgeIp: string;
  }> {
    const response = await this.dockerSocketRequest({
      method: 'GET',
      path: `/containers/${RELAY_CONTAINER}/json`,
    });
    if (!this.isSuccessStatus(response.statusCode)) {
      throw new Error(`Failed to inspect relay container (${response.statusCode ?? 'unknown'}): ${response.body.toString('utf8')}`);
    }

    const payload = this.parseJson<DockerContainerInspect>(response.body, 'Docker relay inspect response');
    const relayEndpoint = Object.values(payload.NetworkSettings?.Networks || {}).find((network) => network?.IPAddress && network.NetworkID);
    const relayBridgeIp = relayEndpoint?.IPAddress?.trim();
    const networkId = relayEndpoint?.NetworkID?.trim();
    if (!relayBridgeIp || !networkId) {
      throw new Error('Relay container network settings are missing bridge IP or network ID');
    }

    const networkResponse = await this.dockerSocketRequest({
      method: 'GET',
      path: `/networks/${encodeURIComponent(networkId)}`,
    });
    if (!this.isSuccessStatus(networkResponse.statusCode)) {
      throw new Error(`Failed to inspect relay network (${networkResponse.statusCode ?? 'unknown'}): ${networkResponse.body.toString('utf8')}`);
    }

    const networkPayload = this.parseJson<DockerNetworkInspect>(networkResponse.body, 'Docker relay network response');
    const bridgeInterface =
      networkPayload.Options?.['com.docker.network.bridge.name']?.trim() ||
      `br-${networkId.slice(0, 12)}`;
    return { bridgeInterface, relayBridgeIp };
  }

  private async applyRelayHostNetworking(networkState: {
    bridgeInterface: string;
    relayBridgeIp: string;
  }): Promise<void> {
    await this.runPrivilegedHostContainer([
      'sh',
      '-c',
      `ip route del ${RELAY_HOST_ROUTE_SUBNET} 2>/dev/null || true; ip route add ${RELAY_HOST_ROUTE_SUBNET} via ${networkState.relayBridgeIp} dev ${networkState.bridgeInterface}`,
    ]);
    await this.runPrivilegedHostContainer([
      'sh',
      '-c',
      `while iptables -t nat -C POSTROUTING -p udp --sport ${RELAY_HOST_UDP_PORT} -d ${networkState.relayBridgeIp} -j SNAT --to-source ${VPN_SERVER_IP} 2>/dev/null; do iptables -t nat -D POSTROUTING -p udp --sport ${RELAY_HOST_UDP_PORT} -d ${networkState.relayBridgeIp} -j SNAT --to-source ${VPN_SERVER_IP}; done; iptables -t nat -A POSTROUTING -p udp --sport ${RELAY_HOST_UDP_PORT} -d ${networkState.relayBridgeIp} -j SNAT --to-source ${VPN_SERVER_IP}`,
    ]);
  }

  private async removeRelayHostNetworking(networkState: {
    bridgeInterface: string;
    relayBridgeIp: string;
  }): Promise<void> {
    await this.runPrivilegedHostContainer([
      'sh',
      '-c',
      `while iptables -t nat -C POSTROUTING -p udp --sport ${RELAY_HOST_UDP_PORT} -d ${networkState.relayBridgeIp} -j SNAT --to-source ${VPN_SERVER_IP} 2>/dev/null; do iptables -t nat -D POSTROUTING -p udp --sport ${RELAY_HOST_UDP_PORT} -d ${networkState.relayBridgeIp} -j SNAT --to-source ${VPN_SERVER_IP}; done`,
    ]);
    await this.runPrivilegedHostContainer([
      'sh',
      '-c',
      `ip route del ${RELAY_HOST_ROUTE_SUBNET} 2>/dev/null || true`,
    ]);
  }

  private async runPrivilegedHostContainer(command: string[]): Promise<void> {
    const helperName = `callytics-relay-host-op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const helperCommand =
      command[0] === 'sh' && command[1] === '-c' && typeof command[2] === 'string'
        ? ['sh', '-c', `apk add --no-cache iproute2 iptables >/dev/null && ${command[2]}`]
        : command;
    const createResponse = await this.dockerSocketRequest({
      method: 'POST',
      path: `/containers/create?name=${encodeURIComponent(helperName)}`,
      body: {
        Image: HOST_HELPER_IMAGE,
        Cmd: helperCommand,
        HostConfig: {
          AutoRemove: false,
          NetworkMode: 'host',
          Privileged: true,
        },
      },
    });
    if (!this.isSuccessStatus(createResponse.statusCode)) {
      throw new Error(`Failed to create host helper container (${createResponse.statusCode ?? 'unknown'}): ${createResponse.body.toString('utf8')}`);
    }

    const createPayload = this.parseJson<{ Id?: string }>(createResponse.body, 'Docker host helper create response');
    const containerId = createPayload.Id;
    if (!containerId) {
      throw new Error('Docker host helper create failed: missing container ID');
    }

    try {
      const startResponse = await this.dockerSocketRequest({
        method: 'POST',
        path: `/containers/${containerId}/start`,
      });
      if (!this.isSuccessStatus(startResponse.statusCode) && startResponse.statusCode !== 304) {
        throw new Error(`Failed to start host helper container (${startResponse.statusCode ?? 'unknown'}): ${startResponse.body.toString('utf8')}`);
      }

      const waitResponse = await this.dockerSocketRequest({
        method: 'POST',
        path: `/containers/${containerId}/wait`,
      });
      if (!this.isSuccessStatus(waitResponse.statusCode)) {
        throw new Error(`Failed to wait for host helper container (${waitResponse.statusCode ?? 'unknown'}): ${waitResponse.body.toString('utf8')}`);
      }

      const waitPayload = this.parseJson<{ StatusCode?: number }>(waitResponse.body, 'Docker host helper wait response');
      if (waitPayload.StatusCode !== 0) {
        const logsResponse = await this.dockerSocketRequest({
          method: 'GET',
          path: `/containers/${containerId}/logs?stdout=1&stderr=1`,
        });
        const logs = logsResponse.body.toString('utf8').trim();
        throw new Error(`Host helper container failed (${waitPayload.StatusCode ?? 'unknown'}): ${logs || 'no logs'}`);
      }
    } finally {
      await this.dockerSocketRequest({
        method: 'DELETE',
        path: `/containers/${containerId}?force=1`,
      }).catch(() => undefined);
    }
  }

  private execInWireguard(command: string[]): Promise<string> {
    return this.execInContainer(this.wireGuardContainer, command);
  }

  private execInContainer(containerName: string, command: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const createExec = await this.dockerSocketRequest({
          method: 'POST',
          path: `/containers/${containerName}/exec`,
          body: {
            AttachStdout: true,
            AttachStderr: true,
            Cmd: command,
          },
        });

        if (!createExec.statusCode || createExec.statusCode < 200 || createExec.statusCode >= 300) {
          reject(new Error(`Docker exec create failed (${createExec.statusCode ?? 'unknown'}): ${createExec.body.toString('utf8')}`));
          return;
        }

        const createPayload = this.parseJson<{ Id?: string }>(createExec.body, 'Docker exec create response');
        const execId = createPayload.Id;
        if (!execId) {
          reject(new Error('Docker exec create failed: missing exec ID'));
          return;
        }

        const startExec = await this.dockerSocketRequest({
          method: 'POST',
          path: `/exec/${execId}/start`,
          body: {
            Detach: false,
            Tty: false,
          },
        });

        if (!startExec.statusCode || startExec.statusCode < 200 || startExec.statusCode >= 300) {
          reject(new Error(`Docker exec start failed (${startExec.statusCode ?? 'unknown'}): ${startExec.body.toString('utf8')}`));
          return;
        }

        const { stdout, stderr } = this.parseDockerMultiplexedStream(startExec.body);

        const inspectExec = await this.dockerSocketRequest({
          method: 'GET',
          path: `/exec/${execId}/json`,
        });

        if (!inspectExec.statusCode || inspectExec.statusCode < 200 || inspectExec.statusCode >= 300) {
          reject(new Error(`Docker exec inspect failed (${inspectExec.statusCode ?? 'unknown'}): ${inspectExec.body.toString('utf8')}`));
          return;
        }

        const inspectPayload = this.parseJson<{ ExitCode?: number }>(inspectExec.body, 'Docker exec inspect response');
        const exitCode = inspectPayload.ExitCode;
        if (typeof exitCode !== 'number') {
          reject(new Error(`WireGuard command exit code unavailable for: ${command.join(' ')}`));
          return;
        }

        if (exitCode !== 0) {
          const output = stderr || stdout || 'no output';
          reject(new Error(`WireGuard command failed (${exitCode}): ${command.join(' ')} :: ${output.trim()}`));
          return;
        }

        resolve(stdout.trim());
      })().catch((error) => {
        reject(error);
      });
    });
  }

  private dockerSocketRequest(options: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    body?: unknown;
  }): Promise<{ statusCode?: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const bodyString = options.body === undefined ? null : JSON.stringify(options.body);
      const request = http.request(
        {
          socketPath: '/var/run/docker.sock',
          host: 'localhost',
          method: options.method,
          path: options.path,
          headers: bodyString
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyString),
              }
            : undefined,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer | string) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          });
          response.on('end', () => {
            resolve({
              statusCode: response.statusCode,
              body: Buffer.concat(chunks),
            });
          });
        },
      );

      request.on('error', reject);
      if (bodyString) {
        request.write(bodyString);
      }
      request.end();
    });
  }

  private parseDockerMultiplexedStream(buffer: Buffer): { stdout: string; stderr: string } {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) {
        throw new Error('Docker exec stream ended with incomplete frame header');
      }

      const streamType = buffer.readUInt8(offset);
      const frameSize = buffer.readUInt32BE(offset + 4);
      const frameStart = offset + 8;
      const frameEnd = frameStart + frameSize;
      if (frameEnd > buffer.length) {
        throw new Error('Docker exec stream ended with incomplete frame payload');
      }

      const framePayload = buffer.subarray(frameStart, frameEnd);
      if (streamType === 1) {
        stdoutChunks.push(framePayload);
      } else if (streamType === 2) {
        stderrChunks.push(framePayload);
      }
      offset = frameEnd;
    }

    return {
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    };
  }

  private parseJson<T>(body: Buffer, label: string): T {
    try {
      return JSON.parse(body.toString('utf8')) as T;
    } catch (error) {
      throw new Error(`${label} was not valid JSON: ${this.toErrorMessage(error)}`);
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private isSuccessStatus(statusCode: number | undefined): boolean {
    if (!statusCode) {
      return false;
    }
    return statusCode >= 200 && statusCode < 300;
  }

  private getEndpointHost(): string {
    return process.env.VPN_PUBLIC_IP || process.env.HOST_IP || '127.0.0.1';
  }
}
