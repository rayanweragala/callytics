import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskModule } from '../asterisk/asterisk.module';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { SipExtensionEntity } from '../extensions/entities/sip-extension.entity';
import { InboundRoutesController } from './inbound-routes.controller';
import { InboundRoutesService } from './inbound-routes.service';
import { InboundRouteEntity } from './entities/inbound-route.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InboundRouteEntity, CallFlowEntity, SipExtensionEntity]), AsteriskModule],
  controllers: [InboundRoutesController],
  providers: [InboundRoutesService],
  exports: [InboundRoutesService],
})
export class InboundRoutesModule {}
