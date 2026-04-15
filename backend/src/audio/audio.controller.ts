import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CreateTtsDto } from './dto/create-tts.dto';
import { PreviewTtsDto } from './dto/preview-tts.dto';
import { AudioService } from './audio.service';

@Controller('audio')
export class AudioController {
  constructor(private readonly audioService: AudioService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    return this.audioService.list(page, limit);
  }

  @Get('voices')
  voices() {
    return this.audioService.listVoices();
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.audioService.getOne(id);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @Body('name') name?: string) {
    return this.audioService.upload(file, name);
  }

  @Post('tts')
  createTts(@Body() dto: CreateTtsDto) {
    return this.audioService.createTts(dto.name, dto.text, dto.voice, dto.speed);
  }

  @Post('tts/preview')
  @HttpCode(200)
  async previewTts(@Body() dto: PreviewTtsDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline');
    await this.audioService.previewTts(dto.text, dto.voice, dto.speed, res);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.audioService.remove(id);
  }
}
