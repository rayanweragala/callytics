import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { AudioFileEntity } from './entities/audio-file.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AudioFileEntity])],
  controllers: [AudioController],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}
