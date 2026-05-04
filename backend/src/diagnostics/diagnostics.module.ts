import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskModule } from '../asterisk/asterisk.module';
import { CaptureModule } from '../capture/capture.module';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsGateway } from './diagnostics.gateway';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [TypeOrmModule.forFeature([SipTrunkEntity]), AsteriskModule, CaptureModule],
  controllers: [DiagnosticsController],
  providers: [DiagnosticsGateway, DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
