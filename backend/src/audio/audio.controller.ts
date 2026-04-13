import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateTtsDto } from './dto/create-tts.dto';
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
    return this.audioService.createTts(dto.name, dto.text, dto.voice);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.audioService.remove(id);
  }
}
