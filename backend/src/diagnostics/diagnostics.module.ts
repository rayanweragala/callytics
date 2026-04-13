import { Module } from '@nestjs/common';
import { DiagnosticsGateway } from './diagnostics.gateway';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  providers: [DiagnosticsGateway, DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
