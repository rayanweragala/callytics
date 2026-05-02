import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SipExtensionEntity } from '../extensions/entities/sip-extension.entity';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { VpnModule } from '../vpn/vpn.module';
import { AsteriskConfigService } from './asterisk-config.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SipExtensionEntity, SipTrunkEntity]),
    forwardRef(() => VpnModule),
  ],
  providers: [AsteriskConfigService],
  exports: [AsteriskConfigService],
})
export class AsteriskModule {}
