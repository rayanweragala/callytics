import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallFlowEntity } from './entities/call-flow.entity';
import { FlowEdgeEntity } from './entities/flow-edge.entity';
import { FlowNodeEntity } from './entities/flow-node.entity';
import { FlowVersionEntity } from './entities/flow-version.entity';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CallFlowEntity,
      FlowVersionEntity,
      FlowNodeEntity,
      FlowEdgeEntity,
    ]),
  ],
  controllers: [FlowsController],
  providers: [FlowsService],
  exports: [FlowsService],
})
export class FlowsModule {}
