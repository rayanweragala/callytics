import { Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, Post, Query, Res, Body, Headers, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { RecordingsService } from './recordings.service';

@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordingsService: RecordingsService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.recordingsService.list(page, limit);
  }

  @Post('internal')
  createInternal(@Body() dto: CreateRecordingDto, @Headers('x-internal-token') internalToken?: string) {
    const expectedToken = process.env.RECORDINGS_INTERNAL_TOKEN;
    if (!expectedToken || !internalToken || internalToken !== expectedToken) {
      throw new UnauthorizedException('Invalid internal recordings token');
    }
    return this.recordingsService.createInternal(dto);
  }

  @Get(':id')
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.recordingsService.getOne(id);
  }

  @Get(':id/stream')
  async stream(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const filePath = await this.recordingsService.getFilePath(id);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline');
    createReadStream(filePath).pipe(res);
  }

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const recording = await this.recordingsService.getOne(id);
    const filePath = await this.recordingsService.getFilePath(id);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="${recording.data.fileName}"`);
    createReadStream(filePath).pipe(res);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.recordingsService.remove(id);
  }
}
