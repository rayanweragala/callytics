import { Module } from '@nestjs/common';
import { CallbacksController } from './callbacks.controller';
import { CallbacksService } from './callbacks.service';

@Module({
  controllers: [CallbacksController],
  providers: [CallbacksService],
  exports: [CallbacksService],
})
export class CallbacksModule {}
