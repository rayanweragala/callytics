import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppLogger } from '../logger/app-logger';
import { CampaignsService } from './campaigns.service';

@Injectable()
export class CampaignsScheduler {
  private readonly logger = new AppLogger(CampaignsScheduler.name);

  constructor(private readonly campaignsService: CampaignsService) {}

  @Cron('*/60 * * * * *')
  async handleCron(): Promise<void> {
    const started = await this.campaignsService.startDueCampaigns();
    if (started.length > 0) {
      this.logger.log(`Started due campaigns: ${started.join(', ')}`);
    }
  }
}
