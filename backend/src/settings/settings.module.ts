import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SipTrunkEntity } from '../trunks/entities/sip-trunk.entity';
import { SettingsController } from './settings.controller';
import { SettingsEntity } from './settings.entity';
import { SettingsService } from './settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([SettingsEntity, SipTrunkEntity])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
