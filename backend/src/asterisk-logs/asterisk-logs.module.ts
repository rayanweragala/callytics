import { Module } from '@nestjs/common';
import { AsteriskLogsController } from './asterisk-logs.controller';
import { AsteriskLogsService } from './asterisk-logs.service';
import { FirewallModule } from '../firewall/firewall.module';

@Module({
  imports: [FirewallModule],
  controllers: [AsteriskLogsController],
  providers: [AsteriskLogsService],
  exports: [AsteriskLogsService],
})
export class AsteriskLogsModule {}
