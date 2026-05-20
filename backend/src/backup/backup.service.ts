import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import { join } from 'node:path';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { runSqlMigrations } from '../db/run-sql-migrations';
import type { ResolvedExtensionConfig } from '../extensions/extensions.service';
import { SipExtensionEntity } from '../extensions/entities/sip-extension.entity';
import { InboundRouteEntity } from '../inbound-routes/entities/inbound-route.entity';
import { AppLogger } from '../logger/app-logger';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import type { UpdateBackupConfigDto } from './dto/update-backup-config.dto';
import { BackupGateway } from './backup.gateway';
import { BackupConfigEntity } from './entities/backup-config.entity';
import { BackupHistoryEntity } from './entities/backup-history.entity';
import type {
  BackupConfigResponse,
  BackupHistoryResponse,
  BackupStatus,
  BackupType,
} from './backup.types';

const BACKUP_DIR = process.env.BACKUP_DIR || '/app/backups';
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/var/lib/asterisk/recording';
const AUDIO_STORAGE_DIR = process.env.AUDIO_STORAGE_DIR || '/app/storage/audio';
const SCHEDULED_NOTE = 'scheduled backup';
const MANUAL_NOTE = 'manual backup';
const ASTERISK_SERVICE_NAME = 'asterisk';
const STASIS_SERVICE_NAME = 'stasis';

interface RestoreOptions {
  restoreDb: boolean;
  restoreRecordings: boolean;
}

interface DockerContainerSummary {
  Id?: string;
  Names?: string[];
  Labels?: Record<string, string>;
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new AppLogger(BackupService.name);

  constructor(
    @InjectRepository(BackupHistoryEntity)
    private readonly backupHistoryRepository: Repository<BackupHistoryEntity>,
    @InjectRepository(BackupConfigEntity)
    private readonly backupConfigRepository: Repository<BackupConfigEntity>,
    @InjectRepository(SipExtensionEntity)
    private readonly extensionsRepository: Repository<SipExtensionEntity>,
    @InjectRepository(InboundRouteEntity)
    private readonly inboundRoutesRepository: Repository<InboundRouteEntity>,
    @InjectRepository(SipTrunkEntity)
    private readonly trunksRepository: Repository<SipTrunkEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly asteriskConfigService: AsteriskConfigService,
    private readonly backupGateway: BackupGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    await runSqlMigrations(this.dataSource);
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  }

  async createBackup(includeRecordings: boolean, note = MANUAL_NOTE): Promise<{ data: BackupHistoryResponse }> {
    const filename = this.buildArchiveName(includeRecordings ? 'full' : 'db_only');
    const history = this.backupHistoryRepository.create({
      filename,
      sizeBytes: '0',
      type: includeRecordings ? 'full' : 'db_only',
      status: 'pending',
      notes: note,
    });

    const savedHistory = await this.backupHistoryRepository.save(history);
    const finalPath = join(BACKUP_DIR, filename);
    let tempDir = '';

    try {
      await this.updateHistoryStatus(savedHistory, 'running', note);
      this.emitBackupProgress(5, 'preparing backup workspace');

      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'callytics-backup-'));
      const dumpPath = join(tempDir, 'database.dump');
      const manifestPath = join(tempDir, 'manifest.json');
      const recordingsArchivePath = join(tempDir, 'recordings.tar.gz');
      const audioArchivePath = join(tempDir, 'audio.tar.gz');

      this.emitBackupProgress(18, 'exporting PostgreSQL database');
      await this.runDatabaseDump(dumpPath);

      const manifest = {
        createdAt: new Date().toISOString(),
        includeRecordings,
        includeAudioFiles: includeRecordings,
        type: includeRecordings ? 'full' : 'db_only',
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      const packageFiles = ['database.dump', 'manifest.json'];
      if (includeRecordings) {
        this.emitBackupProgress(52, 'archiving recordings volume');
        await this.runTarCommand(['-czf', recordingsArchivePath, '-C', RECORDINGS_DIR, '.']);
        this.emitBackupProgress(64, 'archiving audio files');
        await this.runTarCommand(['-czf', audioArchivePath, '-C', AUDIO_STORAGE_DIR, '.']);
        packageFiles.push('recordings.tar.gz');
        packageFiles.push('audio.tar.gz');
      }

      this.emitBackupProgress(80, 'packaging backup archive');
      await this.runTarCommand(['-czf', finalPath, '-C', tempDir, ...packageFiles]);

      const stat = await fs.stat(finalPath);
      const completed = await this.updateHistoryComplete(savedHistory.id, stat.size, note);
      this.emitBackupProgress(100, 'backup archive ready');
      this.backupGateway.emitBackupComplete({ filename: completed.filename, sizeBytes: Number(completed.sizeBytes) });
      return { data: this.toHistoryResponse(completed) };
    } catch (error) {
      await this.safeUnlink(finalPath);
      const message = error instanceof Error ? error.message : 'Backup failed';
      await this.updateHistoryStatus(savedHistory, 'failed', message);
      this.backupGateway.emitBackupError({ message });
      throw new BadRequestException(message);
    } finally {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async restoreBackup(file: Express.Multer.File | undefined, options: RestoreOptions): Promise<{ success: true }> {
    if (!file?.buffer) {
      throw new BadRequestException('backup file is required');
    }
    if (!options.restoreDb && !options.restoreRecordings) {
      throw new BadRequestException('select at least one restore target');
    }
    if (!file.originalname.endsWith('.tar.gz')) {
      throw new BadRequestException('backup file must be a .tar.gz archive');
    }

    let tempDir = '';
    try {
      tempDir = await fs.mkdtemp(join(os.tmpdir(), 'callytics-restore-'));
      const archivePath = join(tempDir, 'restore.tar.gz');
      const extractedDir = join(tempDir, 'extracted');
      const dumpPath = join(extractedDir, 'database.dump');
      const recordingsArchivePath = join(extractedDir, 'recordings.tar.gz');
      const audioArchivePath = join(extractedDir, 'audio.tar.gz');

      this.emitRestoreProgress(8, 'staging uploaded backup archive');
      await fs.mkdir(extractedDir, { recursive: true });
      await fs.writeFile(archivePath, file.buffer);

      this.emitRestoreProgress(18, 'extracting backup archive');
      await this.runTarCommand(['-xzf', archivePath, '-C', extractedDir]);

      if (options.restoreDb) {
        await fs.access(dumpPath).catch(() => {
          throw new BadRequestException('backup archive does not include a database dump');
        });
        this.emitRestoreProgress(40, 'restoring PostgreSQL database');
        await this.runDatabaseRestore(dumpPath);
        this.emitRestoreProgress(62, 'rebuilding managed telephony configuration');
        await this.rebuildTelephonyConfigFromDatabase();
      }

      if (options.restoreRecordings) {
        await fs.access(recordingsArchivePath).catch(() => {
          throw new BadRequestException('backup archive does not include recordings data');
        });
        await fs.access(audioArchivePath).catch(() => {
          throw new BadRequestException('backup archive does not include audio data');
        });
        this.emitRestoreProgress(76, 'restoring recordings volume');
        await fs.rm(RECORDINGS_DIR, { recursive: true, force: true });
        await fs.mkdir(RECORDINGS_DIR, { recursive: true });
        await this.runTarCommand(['-xzf', recordingsArchivePath, '-C', RECORDINGS_DIR]);
        this.emitRestoreProgress(84, 'restoring audio files');
        await fs.rm(AUDIO_STORAGE_DIR, { recursive: true, force: true });
        await fs.mkdir(AUDIO_STORAGE_DIR, { recursive: true });
        await this.runTarCommand(['-xzf', audioArchivePath, '-C', AUDIO_STORAGE_DIR]);
      }

      this.emitRestoreProgress(90, 'signaling runtime services to restart');
      await this.restartAffectedServices(options);

      this.emitRestoreProgress(100, 'restore complete');
      this.backupGateway.emitRestoreComplete();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Restore failed';
      this.backupGateway.emitRestoreError({ message });
      throw new BadRequestException(message);
    } finally {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async listBackups(page = 1, limit = 10): Promise<{ data: BackupHistoryResponse[]; total: number; page: number; limit: number; totalPages: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const [items, total] = await this.backupHistoryRepository.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      data: items.map((item) => this.toHistoryResponse(item)),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    };
  }

  async deleteBackup(id: number): Promise<void> {
    const history = await this.requireHistory(id);
    await this.safeUnlink(join(BACKUP_DIR, history.filename));
    await this.backupHistoryRepository.delete({ id });
  }

  async downloadBackup(id: number): Promise<{ filePath: string; filename: string }> {
    const history = await this.requireHistory(id);
    const filePath = join(BACKUP_DIR, history.filename);
    await fs.access(filePath).catch(() => {
      throw new NotFoundException(`Backup file ${history.filename} not found`);
    });
    return { filePath, filename: history.filename };
  }

  async getConfig(): Promise<BackupConfigResponse> {
    const config = await this.requireConfig();
    return this.toConfigResponse(config);
  }

  async updateConfig(update: UpdateBackupConfigDto): Promise<BackupConfigResponse> {
    const config = await this.requireConfig();
    const nextInterval = update.interval ?? config.interval;
    const nextCronExpression = nextInterval === 'custom'
      ? this.normalizeCronExpression(update.cronExpression ?? config.cronExpression)
      : null;

    config.enabled = update.enabled ?? config.enabled;
    config.interval = nextInterval;
    config.cronExpression = nextCronExpression;
    config.includeRecordings = update.includeRecordings ?? config.includeRecordings;
    config.retentionCount = update.retentionCount ?? config.retentionCount;
    config.updatedAt = new Date();

    const saved = await this.backupConfigRepository.save(config);
    return this.toConfigResponse(saved);
  }

  async handleScheduleTick(): Promise<void> {
    const config = await this.requireConfig();
    if (!config.enabled) {
      return;
    }

    const cronExpression = this.resolveCronExpression(config);
    const now = new Date();
    if (!this.matchesCronExpression(cronExpression, now)) {
      return;
    }

    const minuteStart = new Date(now);
    minuteStart.setSeconds(0, 0);
    const existingCount = await this.backupHistoryRepository.count({
      where: {
        createdAt: MoreThanOrEqual(minuteStart),
        notes: SCHEDULED_NOTE,
      },
    });
    if (existingCount > 0) {
      return;
    }

    await this.createBackup(config.includeRecordings, SCHEDULED_NOTE);
    await this.enforceRetention(config.retentionCount);
  }

  private async enforceRetention(retentionCount: number): Promise<void> {
    const items = await this.backupHistoryRepository.find({
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const overflow = items.slice(Math.max(0, retentionCount));
    for (const item of overflow) {
      await this.deleteBackup(item.id);
    }
  }

  private async rebuildTelephonyConfigFromDatabase(): Promise<void> {
    const [trunks, routes, extensions] = await Promise.all([
      this.trunksRepository.find({
        where: { enabled: true },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.inboundRoutesRepository.find({ order: { did: 'ASC' } }),
      this.extensionsRepository.find({ order: { username: 'ASC' } }),
    ]);

    await this.asteriskConfigService.writeTrunksConfig(trunks);
    await this.syncVpnAclFiles(extensions);
    const resolvedExtensions = extensions.map((extension) => this.resolveExtensionConfig(extension));
    await this.asteriskConfigService.syncExtensions(resolvedExtensions);
    await this.asteriskConfigService.syncInboundRoutes(routes);
  }

  private resolveExtensionConfig(extension: SipExtensionEntity): ResolvedExtensionConfig {
    const transportType = extension.transportType === 'webrtc' ? 'webrtc' : 'sip';
    const endpointFlags = transportType === 'webrtc'
      ? [
          'dtls_auto_generate_cert = yes',
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
        transport: transportType === 'webrtc' ? 'transport-ws' : 'transport-udp',
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
      transport: transportType === 'webrtc' ? 'transport-ws' : 'transport-udp',
      endpointFlags,
    };
  }

  private async syncVpnAclFiles(extensions: SipExtensionEntity[]): Promise<void> {
    const configDir = process.env.ASTERISK_CONFIG_DIR || '/etc/asterisk';
    await fs.mkdir(configDir, { recursive: true });

    const activeFileNames = new Set(
      extensions
        .filter((extension) => extension.vpnOnly)
        .map((extension) => this.vpnAclFileName(extension.username)),
    );

    for (const extension of extensions.filter((item) => item.vpnOnly)) {
      const content = [
        '; auto-generated by callytics — do not edit manually',
        `[${this.vpnAclName(extension.username)}]`,
        'type = acl',
        'deny = 0.0.0.0/0.0.0.0',
        'permit = 10.8.0.0/24',
        '',
      ].join('\n');
      await fs.writeFile(join(configDir, this.vpnAclFileName(extension.username)), content, 'utf8');
    }

    let existingFiles: string[] = [];
    try {
      existingFiles = await fs.readdir(configDir);
    } catch {
      existingFiles = [];
    }

    await Promise.all(
      existingFiles
        .filter((fileName) => fileName.startsWith('pjsip_callytics_vpn_') && fileName.endsWith('.conf'))
        .filter((fileName) => !activeFileNames.has(fileName))
        .map((fileName) => fs.unlink(join(configDir, fileName)).catch(() => undefined)),
    );
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

  private async restartAffectedServices(options: RestoreOptions): Promise<void> {
    const services = new Set<string>();
    if (options.restoreDb) {
      services.add(ASTERISK_SERVICE_NAME);
      services.add(STASIS_SERVICE_NAME);
    }
    if (options.restoreRecordings) {
      services.add(ASTERISK_SERVICE_NAME);
    }

    for (const serviceName of services) {
      await this.restartComposeService(serviceName);
    }
  }

  private async restartComposeService(serviceName: string): Promise<void> {
    const containers = await this.listComposeContainers();
    const container = containers.find((item) => item.Labels?.['com.docker.compose.service'] === serviceName);
    if (!container?.Id) {
      throw new Error(`Unable to locate Docker container for service "${serviceName}"`);
    }

    await this.dockerSocketRequest({
      method: 'POST',
      path: `/containers/${container.Id}/restart`,
    });
  }

  private async listComposeContainers(): Promise<DockerContainerSummary[]> {
    const response = await this.dockerSocketRequest({
      method: 'GET',
      path: '/containers/json',
    });
    return JSON.parse(response.body.toString('utf8')) as DockerContainerSummary[];
  }

  private async dockerSocketRequest(options: { method: string; path: string }): Promise<{ statusCode?: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: '/var/run/docker.sock',
          method: options.method,
          path: options.path,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on('end', () => {
            if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
              resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks) });
              return;
            }
            reject(new Error(`Docker API ${options.method} ${options.path} failed (${response.statusCode ?? 'unknown'})`));
          });
        },
      );

      request.on('error', reject);
      request.end();
    });
  }

  private async runDatabaseDump(outputPath: string): Promise<void> {
    await this.runExecFile('pg_dump', [
      '-h',
      process.env.DB_HOST || '127.0.0.1',
      '-p',
      String(process.env.DB_PORT || '5432'),
      '-U',
      process.env.DB_USER || 'callytics',
      '-d',
      process.env.DB_NAME || 'callytics',
      '-Fc',
      '-f',
      outputPath,
    ]);
  }

  private async runDatabaseRestore(dumpPath: string): Promise<void> {
    await this.runExecFile('pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '-h',
      process.env.DB_HOST || '127.0.0.1',
      '-p',
      String(process.env.DB_PORT || '5432'),
      '-U',
      process.env.DB_USER || 'callytics',
      '-d',
      process.env.DB_NAME || 'callytics',
      dumpPath,
    ]);
  }

  private async runTarCommand(args: string[]): Promise<void> {
    await this.runExecFile('tar', args);
  }

  private async runExecFile(command: string, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        command,
        args,
        {
          env: {
            ...process.env,
            PGPASSWORD: process.env.DB_PASS || 'callytics',
          },
        },
        (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          resolve();
        },
      );
    });
  }

  private buildArchiveName(type: BackupType): string {
    const date = new Date();
    const parts = [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
      '-',
      String(date.getUTCHours()).padStart(2, '0'),
      String(date.getUTCMinutes()).padStart(2, '0'),
      String(date.getUTCSeconds()).padStart(2, '0'),
    ];
    return `callytics-${type}-${parts.join('')}.tar.gz`;
  }

  private async requireHistory(id: number): Promise<BackupHistoryEntity> {
    const history = await this.backupHistoryRepository.findOne({ where: { id } });
    if (!history) {
      throw new NotFoundException(`Backup ${id} not found`);
    }
    return history;
  }

  private async requireConfig(): Promise<BackupConfigEntity> {
    const config = await this.backupConfigRepository.findOne({ where: { id: 1 } });
    if (!config) {
      throw new NotFoundException('Backup config not found');
    }
    return config;
  }

  private async updateHistoryStatus(history: BackupHistoryEntity, status: BackupStatus, notes: string | null): Promise<void> {
    history.status = status;
    history.notes = notes;
    await this.backupHistoryRepository.save(history);
  }

  private async updateHistoryComplete(id: number, sizeBytes: number, notes: string | null): Promise<BackupHistoryEntity> {
    const history = await this.requireHistory(id);
    history.status = 'complete';
    history.sizeBytes = String(sizeBytes);
    history.notes = notes;
    return this.backupHistoryRepository.save(history);
  }

  private toHistoryResponse(item: BackupHistoryEntity): BackupHistoryResponse {
    return {
      id: item.id,
      filename: item.filename,
      sizeBytes: Number(item.sizeBytes),
      type: item.type,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      notes: item.notes,
    };
  }

  private toConfigResponse(item: BackupConfigEntity): BackupConfigResponse {
    const cronExpression = this.resolveCronExpression(item);
    return {
      id: item.id,
      enabled: item.enabled,
      interval: item.interval,
      cronExpression: item.cronExpression,
      includeRecordings: item.includeRecordings,
      retentionCount: item.retentionCount,
      updatedAt: item.updatedAt.toISOString(),
      nextRunAt: item.enabled ? this.computeNextRunAt(cronExpression) : null,
    };
  }

  private resolveCronExpression(config: Pick<BackupConfigEntity, 'interval' | 'cronExpression'>): string {
    if (config.interval === 'daily') {
      return '0 2 * * *';
    }
    if (config.interval === 'weekly') {
      return '0 2 * * 0';
    }
    return this.normalizeCronExpression(config.cronExpression);
  }

  private normalizeCronExpression(value: string | null | undefined): string {
    const normalized = value?.trim() || '';
    if (!normalized) {
      throw new BadRequestException('cron expression is required when interval is custom');
    }
    const fields = normalized.split(/\s+/);
    if (fields.length !== 5) {
      throw new BadRequestException('cron expression must contain exactly 5 fields');
    }
    return normalized;
  }

  private computeNextRunAt(cronExpression: string): string | null {
    const probe = new Date();
    probe.setSeconds(0, 0);
    for (let minuteOffset = 1; minuteOffset <= 60 * 24 * 366; minuteOffset += 1) {
      const candidate = new Date(probe.getTime() + minuteOffset * 60_000);
      if (this.matchesCronExpression(cronExpression, candidate)) {
        return candidate.toISOString();
      }
    }
    return null;
  }

  private matchesCronExpression(cronExpression: string, date: Date): boolean {
    const [minuteField, hourField, dayField, monthField, weekDayField] = cronExpression.trim().split(/\s+/);
    return (
      this.matchesCronField(minuteField, date.getMinutes(), 0, 59) &&
      this.matchesCronField(hourField, date.getHours(), 0, 23) &&
      this.matchesCronField(dayField, date.getDate(), 1, 31) &&
      this.matchesCronField(monthField, date.getMonth() + 1, 1, 12) &&
      this.matchesCronField(weekDayField, date.getDay(), 0, 6)
    );
  }

  private matchesCronField(field: string, value: number, min: number, max: number): boolean {
    return field.split(',').some((token) => this.matchesCronToken(token.trim(), value, min, max));
  }

  private matchesCronToken(token: string, value: number, min: number, max: number): boolean {
    if (token === '*') {
      return true;
    }

    const [rangePart, stepPart] = token.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      return false;
    }

    let rangeStart = min;
    let rangeEnd = max;

    if (rangePart !== '*') {
      if (rangePart.includes('-')) {
        const [startText, endText] = rangePart.split('-');
        rangeStart = Number(startText);
        rangeEnd = Number(endText);
      } else {
        const exact = Number(rangePart);
        if (!Number.isInteger(exact)) {
          return false;
        }
        rangeStart = exact;
        rangeEnd = exact;
      }
    }

    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd)) {
      return false;
    }
    if (rangeStart < min || rangeEnd > max || rangeStart > rangeEnd) {
      return false;
    }
    if (value < rangeStart || value > rangeEnd) {
      return false;
    }
    return (value - rangeStart) % step === 0;
  }

  private emitBackupProgress(percentage: number, step: string): void {
    this.backupGateway.emitBackupProgress({ percentage, step });
  }

  private emitRestoreProgress(percentage: number, step: string): void {
    this.backupGateway.emitRestoreProgress({ percentage, step });
  }

  private async safeUnlink(filePath: string): Promise<void> {
    await fs.unlink(filePath).catch(() => undefined);
  }
}
