import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AsteriskConfigService } from '../asterisk/asterisk-config.service';
import { ExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';
import { SipExtensionEntity } from './entities/sip-extension.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SipExtensionEntity])],
  controllers: [ExtensionsController],
  providers: [ExtensionsService, AsteriskConfigService],
  exports: [ExtensionsService],
})
export class ExtensionsModule {}
