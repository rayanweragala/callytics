import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskModule } from '../asterisk/asterisk.module';
import { InboundRouteEntity } from '../inbound-routes/entities/inbound-route.entity';
import { SipExtensionEntity } from '../extensions/entities/sip-extension.entity';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { BackupController } from './backup.controller';
import { BackupGateway } from './backup.gateway';
import { BackupScheduler } from './backup.scheduler';
import { BackupService } from './backup.service';
import { BackupConfigEntity } from './entities/backup-config.entity';
import { BackupHistoryEntity } from './entities/backup-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BackupHistoryEntity,
      BackupConfigEntity,
      SipExtensionEntity,
      InboundRouteEntity,
      SipTrunkEntity,
    ]),
    AsteriskModule,
  ],
  controllers: [BackupController],
  providers: [BackupGateway, BackupScheduler, BackupService],
})
export class BackupModule {}
