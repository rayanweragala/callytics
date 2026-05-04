import { Controller, DefaultValuePipe, Get, Param, Query } from '@nestjs/common';
import { CallLogsService } from './call-logs.service';
import { Response } from 'express';
import { Res } from '@nestjs/common';

@Controller('call-logs')
export class CallLogsController {
  constructor(private readonly callLogsService: CallLogsService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1)) page: number,
    @Query('limit', new DefaultValuePipe(25)) limit: number,
    @Query('search') search?: string,
    @Query('endReason') endReason?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('direction') direction?: string,
    @Query('callLogId') callLogId?: string,
  ) {
    return this.callLogsService.list({ page, limit, search, endReason, dateFrom, dateTo, direction, callLogId });
  }

  @Get('export')
  async exportCsv(
    @Query('search') search: string | undefined,
    @Query('endReason') endReason: string | undefined,
    @Query('dateFrom') dateFrom: string | undefined,
    @Query('dateTo') dateTo: string | undefined,
    @Query('direction') direction: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.callLogsService.exportCsv({ search, endReason, dateFrom, dateTo, direction });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cdr-export.csv"');
    res.send(csv);
  }

  @Get(':callUuid/trace')
  trace(@Param('callUuid') callUuid: string) {
    return this.callLogsService.getTrace(callUuid);
  }
}
