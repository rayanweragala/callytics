import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SipExtensionEntity } from '../extensions/entities/sip-extension.entity';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { AsteriskConfigService } from './asterisk-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([SipExtensionEntity, SipTrunkEntity])],
  providers: [AsteriskConfigService],
  exports: [AsteriskConfigService],
})
export class AsteriskModule {}
