import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { SettingsModule } from '../settings/settings.module';
import { CallRecordingEntity } from './entities/call-recording.entity';
import { RecordingRetentionService } from './recording-retention.service';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [TypeOrmModule.forFeature([CallRecordingEntity, CallFlowEntity]), SettingsModule],
  controllers: [RecordingsController],
  providers: [RecordingsService, RecordingRetentionService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
