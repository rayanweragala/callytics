import { Module } from '@nestjs/common';
import { CallLogsController } from './call-logs.controller';
import { CallLogsListener } from './call-logs.listener';
import { CallLogsService } from './call-logs.service';

@Module({
  controllers: [CallLogsController],
  providers: [CallLogsService, CallLogsListener],
  exports: [CallLogsService],
})
export class CallLogsModule {}
