import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as http from 'node:http';
import * as net from 'node:net';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { DataSource, IsNull, Repository } from 'typeorm';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { VpnPeerEntity } from './entities/vpn-peer.entity';
import type {
  CreatedVpnPeerResponse,
  RelayGuideStep,
  VpnPeerResponse,
  VpnPeerStatus,
  VpnStatusResponse,
} from './vpn.types';

const VPN_SUBNET = '10.8.0.0/24';
const VPN_PREFIX = '10.8.0.';
const VPN_SERVER_IP = '10.8.0.1';
const WIREGUARD_INTERFACE = 'wg0';
const WIREGUARD_PORT = 51820;

interface WireGuardPeerDump {
  publicKey: string;
  lastHandshakeEpoch: number;
  bytesReceived: number;
  bytesSent: number;
}

interface DockerContainerStatus {
  Names?: string[];
  State?: string;
}

interface ServerPublicKeyResult {
  value: string | null;
  error: string | null;
}

@Injectable()
export class VpnService implements OnModuleInit {
  private readonly configDir = process.env.WIREGUARD_CONFIG_DIR || join(process.cwd(), '..', 'wireguard-config');
  private readonly wireGuardContainer = 'callytics-wireguard-1';
  private cachedPublicIp: string | null = null;
  private cachedPublicIpAt = 0;

  constructor(
    @InjectRepository(VpnPeerEntity)
    private readonly peersRepository: Repository<VpnPeerEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await runSqlMigrations(this.dataSource);
    } catch (error) {
      throw error;
    }
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
      const serverPublicKey = await this.getServerPublicKey();
      const endpoint = `${this.getEndpointHost()}:${WIREGUARD_PORT}`;
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
                explanation: 'Allows WireGuard traffic through UFW when UFW is enabled.',
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
                command: `# Callytics endpoint: ${endpoint}\n# Callytics public key: ${serverPublicKey || 'unavailable until WireGuard is running'}`,
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
      const keyPair = await this.generateKeyPair();
      return {
        config: [
          '[Interface]',
          `PrivateKey = ${keyPair.privateKey}`,
          `Address = ${VPN_SERVER_IP}/24`,
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
      const privateKey = await this.execInWireguard(['wg', 'genkey']);
      const publicKey = await this.execInWireguard(['sh', '-c', `echo ${privateKey} | wg pubkey`]);
      return { privateKey, publicKey };
    } catch (error) {
      throw new BadRequestException(`Failed to generate WireGuard keys: ${this.toErrorMessage(error)}`);
    }
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

  private runHostCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: 8000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      });
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

  private execInWireguard(command: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      void (async () => {
        const createExec = await this.dockerSocketRequest({
          method: 'POST',
          path: `/containers/${this.wireGuardContainer}/exec`,
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
