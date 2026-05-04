import { Module } from '@nestjs/common';
import { PreflightController } from './preflight.controller';
import { PreflightService } from './preflight.service';

@Module({
  controllers: [PreflightController],
  providers: [PreflightService],
  exports: [PreflightService],
})
export class PreflightModule {}
