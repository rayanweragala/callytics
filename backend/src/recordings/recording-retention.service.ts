import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { LessThan, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { CallRecordingEntity } from './entities/call-recording.entity';

const RECORDINGS_DIRECTORY = '/var/lib/asterisk/recordings';
const LEGACY_RECORDINGS_DIRECTORY = '/var/lib/asterisk/recording';

@Injectable()
export class RecordingRetentionService {
  private readonly logger = new Logger(RecordingRetentionService.name);

  constructor(
    @InjectRepository(CallRecordingEntity)
    private readonly recordingsRepository: Repository<CallRecordingEntity>,
    private readonly settingsService: SettingsService,
  ) {}

  @Cron('0 0 2 * * *')
  async handleCron(): Promise<void> {
    try {
      const retentionValue = await this.settingsService.get('recording_retention_days');
      const retentionDays = typeof retentionValue === 'number' && retentionValue >= 0 ? retentionValue : 0;

      if (retentionDays === 0) {
        this.logger.log('recording retention skipped: recordings are configured to be kept indefinitely');
        return;
      }

      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const expiredRecordings = await this.recordingsRepository.find({
        where: { createdAt: LessThan(cutoff) },
        order: { createdAt: 'ASC' },
      });

      let deletedCount = 0;
      let freedBytes = 0;

      for (const recording of expiredRecordings) {
        try {
          const bytesFreed = await this.deleteRecordingFile(recording);
          await this.recordingsRepository.delete({ id: recording.id });
          deletedCount += 1;
          freedBytes += bytesFreed;
        } catch (error: unknown) {
          this.logger.warn(
            `failed to prune recording ${recording.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `recording retention deleted ${deletedCount} recordings and freed ${freedBytes} bytes`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `recording retention job failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async deleteRecordingFile(recording: CallRecordingEntity): Promise<number> {
    const candidatePaths = this.resolveCandidatePaths(recording);
    let lastError: Error | null = null;

    for (const filePath of candidatePaths) {
      try {
        const stats = await fs.stat(filePath);
        await fs.unlink(filePath);
        return stats.size;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          lastError = error instanceof Error ? error : new Error(String(error));
          continue;
        }
        throw error;
      }
    }

    if (lastError) {
      this.logger.warn(`recording file already missing for row ${recording.id}`);
      return 0;
    }

    throw new Error(`no candidate file paths resolved for recording ${recording.id}`);
  }

  private resolveCandidatePaths(recording: CallRecordingEntity): string[] {
    const normalized = recording.filePath.trim();
    const fileName = basename(normalized);
    const candidates = new Set<string>();

    if (normalized) {
      candidates.add(normalized);
    }

    if (fileName) {
      candidates.add(join(RECORDINGS_DIRECTORY, fileName));
      candidates.add(join(LEGACY_RECORDINGS_DIRECTORY, fileName));
    }

    if (normalized.startsWith(`${LEGACY_RECORDINGS_DIRECTORY}/`)) {
      candidates.add(normalized.replace(`${LEGACY_RECORDINGS_DIRECTORY}/`, `${RECORDINGS_DIRECTORY}/`));
    }

    if (normalized.startsWith(`${RECORDINGS_DIRECTORY}/`)) {
      candidates.add(normalized.replace(`${RECORDINGS_DIRECTORY}/`, `${LEGACY_RECORDINGS_DIRECTORY}/`));
    }

    return Array.from(candidates);
  }
}
