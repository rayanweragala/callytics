import { Module } from '@nestjs/common';
import { AsteriskLogsController } from './asterisk-logs.controller';
import { AsteriskLogsService } from './asterisk-logs.service';

@Module({
  controllers: [AsteriskLogsController],
  providers: [AsteriskLogsService],
  exports: [AsteriskLogsService],
})
export class AsteriskLogsModule {}
