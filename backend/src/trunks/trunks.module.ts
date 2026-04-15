import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskModule } from '../asterisk/asterisk.module';
import { TrunksController } from './trunks.controller';
import { TrunksService } from './trunks.service';
import { SipTrunkEntity } from './entities/sip-trunk.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SipTrunkEntity]), AsteriskModule],
  controllers: [TrunksController],
  providers: [TrunksService],
  exports: [TrunksService],
})
export class TrunksModule {}
