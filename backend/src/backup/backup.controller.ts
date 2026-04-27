import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { BackupService } from './backup.service';
import { CreateBackupDto } from './dto/create-backup.dto';
import { RestoreBackupQueryDto } from './dto/restore-backup-query.dto';
import { UpdateBackupConfigDto } from './dto/update-backup-config.dto';

@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post()
  createBackup(@Body() dto: CreateBackupDto) {
    return this.backupService.createBackup(dto.includeRecordings);
  }

  @Get()
  listBackups(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.backupService.listBackups(page, limit);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteBackup(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.backupService.deleteBackup(id);
  }

  @Get(':id/download')
  async downloadBackup(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const { filePath, filename } = await this.backupService.downloadBackup(id);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    createReadStream(filePath).pipe(res);
  }

  @Post('restore')
  @UseInterceptors(FileInterceptor('file'))
  restoreBackup(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: RestoreBackupQueryDto,
  ) {
    return this.backupService.restoreBackup(file, {
      restoreDb: query.restoreDb,
      restoreRecordings: query.restoreRecordings,
    });
  }

  @Get('config')
  getConfig() {
    return this.backupService.getConfig();
  }

  @Put('config')
  updateConfig(@Body() dto: UpdateBackupConfigDto) {
    return this.backupService.updateConfig(dto);
  }
}
