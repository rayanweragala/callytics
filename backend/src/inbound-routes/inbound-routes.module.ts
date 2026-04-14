import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { CallFlowEntity } from '../flows/entities/call-flow.entity';
import { InboundRoutesController } from './inbound-routes.controller';
import { InboundRoutesService } from './inbound-routes.service';
import { InboundRouteEntity } from './entities/inbound-route.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InboundRouteEntity, CallFlowEntity])],
  controllers: [InboundRoutesController],
  providers: [InboundRoutesService, AsteriskConfigService],
  exports: [InboundRoutesService],
})
export class InboundRoutesModule {}
