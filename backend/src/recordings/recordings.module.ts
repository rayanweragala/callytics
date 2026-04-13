import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { CallRecordingEntity } from './entities/call-recording.entity';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [TypeOrmModule.forFeature([CallRecordingEntity, CallFlowEntity])],
  controllers: [RecordingsController],
  providers: [RecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
