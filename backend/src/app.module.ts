import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioModule } from './audio/audio.module';
import { AsteriskModule } from './asterisk/asterisk.module';
import { AudioFileEntity } from './audio/entities/audio-file.entity';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { ExtensionsModule } from './extensions/extensions.module';
import { SipExtensionEntity } from './extensions/entities/sip-extension.entity';
import { SipTrunkEntity } from './trunks/entities/sip-trunk.entity';
import { CallFlowEntity } from './flows/entities/call-flow.entity';
import { FlowEdgeEntity } from './flows/entities/flow-edge.entity';
import { FlowNodeEntity } from './flows/entities/flow-node.entity';
import { FlowVersionEntity } from './flows/entities/flow-version.entity';
import { FlowsModule } from './flows/flows.module';
import { HealthController } from './health/health.controller';
import { InboundRoutesModule } from './inbound-routes/inbound-routes.module';
import { InboundRouteEntity } from './inbound-routes/entities/inbound-route.entity';
import { CallRecordingEntity } from './recordings/entities/call-recording.entity';
import { RecordingsModule } from './recordings/recordings.module';
import { BackendConfigModule } from './config/config.module';
import { TrunksModule } from './trunks/trunks.module';
import { CallLogsModule } from './call-logs/call-logs.module';
import { TemplatesModule } from './templates/templates.module';
import { OperatorsModule } from './operators/operators.module';
import { OperatorEntity } from './operators/entities/operator.entity';
import { QueuesModule } from './queues/queues.module';
import { QueueEntity } from './queues/entities/queue.entity';
import { ContactNumberEntity } from './contact-numbers/entities/contact-number.entity';
import { ContactNumbersModule } from './contact-numbers/contact-numbers.module';
import { CaptureModule } from './capture/capture.module';
import { QualityModule } from './quality/quality.module';
import { AsteriskLogsModule } from './asterisk-logs/asterisk-logs.module';
import { PreflightModule } from './preflight/preflight.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CallbacksModule } from './callbacks/callbacks.module';
import { HttpLoggingInterceptor } from './logger/http-logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
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
        entities: [
          CallFlowEntity,
          FlowVersionEntity,
          FlowNodeEntity,
          FlowEdgeEntity,
          AudioFileEntity,
          CallRecordingEntity,
          SipExtensionEntity,
          SipTrunkEntity,
          InboundRouteEntity,
          OperatorEntity,
          QueueEntity,
          ContactNumberEntity,
        ],
        synchronize: false,
        logging: false,
        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
    DiagnosticsModule,
    CaptureModule,
    FlowsModule,
    AudioModule,
    RecordingsModule,
    AsteriskModule,
    ExtensionsModule,
    InboundRoutesModule,
    BackendConfigModule,
    TrunksModule,
    CallLogsModule,
    TemplatesModule,
    OperatorsModule,
    QueuesModule,
    ContactNumbersModule,
    QualityModule,
    AsteriskLogsModule,
    PreflightModule,
    CampaignsModule,
    CallbacksModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
  ],
})
export class AppModule {}
