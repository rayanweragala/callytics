import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppLogger } from '../logger/app-logger';
import { BackupService } from './backup.service';

@Injectable()
export class BackupScheduler {
  private readonly logger = new AppLogger(BackupScheduler.name);

  constructor(private readonly backupService: BackupService) {}

  @Cron('0 * * * * *')
  async handleCron(): Promise<void> {
    try {
      await this.backupService.handleScheduleTick();
    } catch (error) {
      this.logger.warn(`backup scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
