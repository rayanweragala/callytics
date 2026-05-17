import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings() {
    return this.settingsService.getAll();
  }

  @Patch()
  async updateSettings(@Body() patch: Record<string, boolean | number | string | null>) {
    return this.settingsService.updateMany(patch);
  }

  @Get('default-trunk')
  async getDefaultTrunk() {
    return this.settingsService.getDefaultTrunk();
  }
}
