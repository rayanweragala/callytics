import { Module } from '@nestjs/common';
import { FirewallController } from './firewall.controller';
import { FirewallGateway } from './firewall.gateway';
import { FirewallService } from './firewall.service';

@Module({
  controllers: [FirewallController],
  providers: [FirewallGateway, FirewallService],
  exports: [FirewallService],
})
export class FirewallModule {}
