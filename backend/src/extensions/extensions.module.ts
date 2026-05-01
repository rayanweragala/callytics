import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskModule } from '../asterisk/asterisk.module';
import { InboundRouteEntity } from '../inbound-routes/entities/inbound-route.entity';
import { VpnModule } from '../vpn/vpn.module';
import { ExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';
import { SipExtensionEntity } from './entities/sip-extension.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SipExtensionEntity, InboundRouteEntity]), AsteriskModule, VpnModule],
  controllers: [ExtensionsController],
  providers: [ExtensionsService],
  exports: [ExtensionsService],
})
export class ExtensionsModule {}
