import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CampaignsService } from './campaigns.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.campaignsService.list(limit, offset);
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.getById(id);
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.campaignsService.create({
      name: typeof body.name === 'string' ? body.name : undefined,
      flowId: typeof body.flowId === 'number' ? body.flowId : body.flowId === null ? null : undefined,
      trunkId: typeof body.trunkId === 'number' ? body.trunkId : body.trunkId === null ? null : undefined,
      callerId: typeof body.callerId === 'string' ? body.callerId : body.callerId === null ? null : undefined,
      defaultCountry: typeof body.defaultCountry === 'string' ? body.defaultCountry : undefined,
      scheduledAt: typeof body.scheduledAt === 'string' ? body.scheduledAt : body.scheduledAt === null ? null : undefined,
      maxConcurrent: typeof body.maxConcurrent === 'number' ? body.maxConcurrent : undefined,
      maxRetries: typeof body.maxRetries === 'number' ? body.maxRetries : undefined,
      retryIntervalMinutes: typeof body.retryIntervalMinutes === 'number' ? body.retryIntervalMinutes : undefined,
    });
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.campaignsService.update(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      flowId: typeof body.flowId === 'number' ? body.flowId : body.flowId === null ? null : undefined,
      trunkId: typeof body.trunkId === 'number' ? body.trunkId : body.trunkId === null ? null : undefined,
      callerId: typeof body.callerId === 'string' ? body.callerId : body.callerId === null ? null : undefined,
      defaultCountry: typeof body.defaultCountry === 'string' ? body.defaultCountry : undefined,
      scheduledAt: typeof body.scheduledAt === 'string' ? body.scheduledAt : body.scheduledAt === null ? null : undefined,
      maxConcurrent: typeof body.maxConcurrent === 'number' ? body.maxConcurrent : undefined,
      maxRetries: typeof body.maxRetries === 'number' ? body.maxRetries : undefined,
      retryIntervalMinutes: typeof body.retryIntervalMinutes === 'number' ? body.retryIntervalMinutes : undefined,
    });
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ ok: true }> {
    await this.campaignsService.remove(id);
    return { ok: true };
  }

  @Post(':id/contacts/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadContacts(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }
    return this.campaignsService.uploadContacts(id, file.buffer);
  }

  @Get(':id/contacts')
  listContacts(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('status') status?: string,
  ) {
    return this.campaignsService.listContacts(id, limit, offset, status);
  }

  @Get(':id/contacts/:contactId/attempts')
  listContactAttempts(
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    return this.campaignsService.listContactAttempts(id, contactId);
  }

  @Post(':id/schedule')
  schedule(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.schedule(id);
  }

  @Post(':id/stop')
  stop(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.stop(id);
  }

  @Get(':id/progress')
  progress(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.getProgress(id);
  }
}
