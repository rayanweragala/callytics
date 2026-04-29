import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DataSource, Repository } from 'typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import { VpnService } from '../vpn/vpn.service';
import { CreateExtensionDto } from './dto/create-extension.dto';
import { UpdateExtensionDto } from './dto/update-extension.dto';
import { SipExtensionEntity } from './entities/sip-extension.entity';

export interface ExtensionResponse {
  id: number;
  username: string;
  password: string;
  displayName: string | null;
  transportType: 'sip' | 'webrtc';
  vpnOnly: boolean;
  createdAt: string;
}

export interface ResolvedExtensionConfig {
  username: string;
  password: string;
  transport: string;
  endpointFlags: string[];
}

@Injectable()
export class ExtensionsService implements OnModuleInit {
  private readonly configDir = process.env.ASTERISK_CONFIG_DIR || '/etc/asterisk';

  constructor(
    @InjectRepository(SipExtensionEntity)
    private readonly extensionsRepository: Repository<SipExtensionEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly asteriskConfigService: AsteriskConfigService,
    private readonly vpnService: VpnService,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await this.rebuildConfig();
  }

  async list(limit = 20, offset = 0): Promise<{ data: ExtensionResponse[]; total: number }> {
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);
    const [items, total] = await this.extensionsRepository.findAndCount({
      order: { username: 'ASC' },
      take: safeLimit,
      skip: safeOffset,
    });
    return {
      data: items.map((item) => this.toResponse(item)),
      total,
    };
  }

  async create(dto: CreateExtensionDto): Promise<{ data: ExtensionResponse }> {
    const username = this.normalizeRequired(dto.username, 'username');
    const password = this.normalizeRequired(dto.password, 'password');
    const vpnOnly = Boolean(dto.vpnOnly);
    const existing = await this.extensionsRepository.findOne({ where: { username } });
    if (existing) {
      throw new BadRequestException(`Extension username ${username} already exists`);
    }
    if (vpnOnly) {
      const installed = await this.vpnService.isInstalled();
      if (!installed) {
        throw new BadRequestException('VPN is not installed. Enable WireGuard before restricting extensions to VPN-only.');
      }
    }

    const entity = this.extensionsRepository.create({
      username,
      password,
      displayName: this.normalizeOptional(dto.displayName),
      transportType: dto.transportType ?? 'sip',
      vpnOnly,
    });
    const saved = await this.extensionsRepository.save(entity);
    await this.rebuildConfig();
    return { data: this.toResponse(saved) };
  }

  async update(id: number, dto: UpdateExtensionDto): Promise<{ data: ExtensionResponse }> {
    const entity = await this.extensionsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Extension ${id} not found`);
    }

    if (dto.username !== undefined) {
      const username = this.normalizeRequired(dto.username, 'username');
      const conflict = await this.extensionsRepository.findOne({ where: { username } });
      if (conflict && conflict.id !== id) {
        throw new BadRequestException(`Extension username ${username} already exists`);
      }
      entity.username = username;
    }

    if (dto.password !== undefined) {
      entity.password = this.normalizeRequired(dto.password, 'password');
    }

    if (dto.displayName !== undefined) {
      entity.displayName = this.normalizeOptional(dto.displayName);
    }

    if (dto.transportType !== undefined) {
      entity.transportType = dto.transportType;
    }

    if (dto.vpnOnly !== undefined) {
      if (dto.vpnOnly) {
        const installed = await this.vpnService.isInstalled();
        if (!installed) {
          throw new BadRequestException('VPN is not installed. Enable WireGuard before restricting extensions to VPN-only.');
        }
      }
      entity.vpnOnly = dto.vpnOnly;
    }

    const saved = await this.extensionsRepository.save(entity);
    await this.rebuildConfig();
    return { data: this.toResponse(saved) };
  }

  async remove(id: number): Promise<{ data: { id: number; deleted: true } }> {
    const entity = await this.extensionsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException(`Extension ${id} not found`);
    }

    await this.extensionsRepository.delete({ id });
    await this.rebuildConfig();
    return { data: { id, deleted: true } };
  }

  async getQrContent(id: number): Promise<{ data: { content: string } }> {
    const extension = await this.extensionsRepository.findOne({ where: { id } });
    if (!extension) {
      throw new NotFoundException(`Extension ${id} not found`);
    }
    const hostIp = process.env.HOST_IP || '127.0.0.1';
    const content = `sip:${extension.username}@${hostIp}:5080\npassword:${extension.password}\ntransport:udp`;
    return { data: { content } };
  }

  private async rebuildConfig(): Promise<void> {
    const extensions = await this.extensionsRepository.find({ order: { username: 'ASC' } });
    await this.syncVpnAclFiles(extensions);
    const resolvedConfigs = extensions.map((extension) => this.resolveAsteriskConfig(extension));
    await this.asteriskConfigService.syncExtensions(resolvedConfigs);
  }

  private resolveAsteriskConfig(extension: SipExtensionEntity): ResolvedExtensionConfig {
    const transportType = extension.transportType === 'webrtc' ? 'webrtc' : 'sip';
    const endpointFlags = transportType === 'webrtc'
      ? [
          'dtls_auto_generate_cert = yes',
          'webrtc = yes',
          'use_avpf = yes',
          'media_encryption = dtls',
          'ice_support = yes',
          'media_use_received_transport = yes',
        ]
      : [];

    if (extension.vpnOnly) {
      return {
        username: extension.username,
        password: extension.password,
        transport: transportType === 'webrtc' ? 'transport-wss' : 'transport-udp',
        endpointFlags: [
          ...endpointFlags,
          `acl = ${this.vpnAclName(extension.username)}`,
          `#include ${this.vpnAclFileName(extension.username)}`,
        ],
      };
    }
    return {
      username: extension.username,
      password: extension.password,
      transport: transportType === 'webrtc' ? 'transport-wss' : 'transport-udp',
      endpointFlags,
    };
  }

  private toResponse(item: SipExtensionEntity): ExtensionResponse {
    return {
      id: item.id,
      username: item.username,
      password: item.password,
      displayName: item.displayName,
      transportType: item.transportType || 'sip',
      vpnOnly: Boolean(item.vpnOnly),
      createdAt: item.createdAt.toISOString(),
    };
  }

  private async syncVpnAclFiles(extensions: SipExtensionEntity[]): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    const activeFileNames = new Set(
      extensions
        .filter((extension) => extension.vpnOnly)
        .map((extension) => this.vpnAclFileName(extension.username)),
    );
    for (const extension of extensions.filter((item) => item.vpnOnly)) {
      await fs.writeFile(
        join(this.configDir, this.vpnAclFileName(extension.username)),
        this.buildVpnAclConfig(extension.username),
        'utf8',
      );
    }

    let existingFiles: string[] = [];
    try {
      existingFiles = await fs.readdir(this.configDir);
    } catch {
      existingFiles = [];
    }
    await Promise.all(
      existingFiles
        .filter((fileName) => fileName.startsWith('pjsip_callytics_vpn_') && fileName.endsWith('.conf'))
        .filter((fileName) => !activeFileNames.has(fileName))
        .map(async (fileName) => {
          try {
            await fs.unlink(join(this.configDir, fileName));
          } catch {
            return;
          }
        }),
    );
  }

  private buildVpnAclConfig(username: string): string {
    return [
      '; auto-generated by callytics — do not edit manually',
      `[${this.vpnAclName(username)}]`,
      'type = acl',
      'deny = 0.0.0.0/0.0.0.0',
      'permit = 10.8.0.0/24',
      '',
    ].join('\n');
  }

  private vpnAclName(username: string): string {
    return `${this.safeConfigToken(username)}-vpn-acl`;
  }

  private vpnAclFileName(username: string): string {
    return `pjsip_callytics_vpn_${this.safeConfigToken(username)}.conf`;
  }

  private safeConfigToken(value: string): string {
    return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
  }

  private normalizeRequired(value: string | undefined, field: string): string {
    const normalized = (value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized;
  }

  private normalizeOptional(value?: string): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }
}
