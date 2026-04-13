import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioModule } from './audio/audio.module';
import { AudioFileEntity } from './audio/entities/audio-file.entity';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { CallFlowEntity } from './flows/entities/call-flow.entity';
import { FlowEdgeEntity } from './flows/entities/flow-edge.entity';
import { FlowNodeEntity } from './flows/entities/flow-node.entity';
import { FlowVersionEntity } from './flows/entities/flow-version.entity';
import { FlowsModule } from './flows/flows.module';
import { HealthController } from './health/health.controller';
import { CallRecordingEntity } from './recordings/entities/call-recording.entity';
import { RecordingsModule } from './recordings/recordings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        database: config.get('DB_NAME', 'callytics'),
        username: config.get('DB_USER', 'callytics'),
        password: config.get('DB_PASS', 'callytics'),
        entities: [CallFlowEntity, FlowVersionEntity, FlowNodeEntity, FlowEdgeEntity, AudioFileEntity, CallRecordingEntity],
        synchronize: false,
        logging: false,
        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
    DiagnosticsModule,
    FlowsModule,
    AudioModule,
    RecordingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
