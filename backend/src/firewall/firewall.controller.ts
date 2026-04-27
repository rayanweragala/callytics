import { Body, Controller, Delete, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { FirewallService } from './firewall.service';
import { FirewallWhitelistDto, ManualFirewallBlockDto, UpdateFirewallConfigDto } from './dto';
import type { FirewallEventType } from './firewall.types';

@Controller('firewall')
export class FirewallController {
  constructor(private readonly firewallService: FirewallService) {}

  @Get('config')
  getConfig() {
    return this.firewallService.getConfig();
  }

  @Put('config')
  updateConfig(@Body() dto: UpdateFirewallConfigDto) {
    return this.firewallService.updateConfig(dto);
  }

  @Get('preflight')
  getPreflight() {
    return this.firewallService.getPreflightStatus();
  }

  @Get('blocked-ips')
  listBlockedIps() {
    return this.firewallService.listBlockedIps();
  }

  @Post('blocked-ips')
  @HttpCode(200)
  manualBlock(@Body() dto: ManualFirewallBlockDto) {
    return this.firewallService.manualBlock(dto.ip, dto.reason || 'manual block');
  }

  @Delete('blocked-ips/:ip')
  @HttpCode(204)
  async unblock(@Param('ip') ip: string): Promise<void> {
    await this.firewallService.unblock(ip);
  }

  @Post('whitelist')
  @HttpCode(200)
  addWhitelist(@Body() dto: FirewallWhitelistDto) {
    return this.firewallService.addWhitelist(dto.ip, dto.reason || 'manual whitelist');
  }

  @Delete('whitelist/:ip')
  @HttpCode(204)
  async removeWhitelist(@Param('ip') ip: string): Promise<void> {
    await this.firewallService.removeWhitelist(ip);
  }

  @Get('events')
  listEvents(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('eventType') eventType?: FirewallEventType,
  ) {
    return this.firewallService.listEvents(page, limit, eventType);
  }

  @Get('stats')
  getStats() {
    return this.firewallService.getStats();
  }
}
