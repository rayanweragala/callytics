import { Controller, DefaultValuePipe, Get, Param, Query } from '@nestjs/common';
import { CallLogsService } from './call-logs.service';

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
  ) {
    return this.callLogsService.list({ page, limit, search, endReason, dateFrom, dateTo });
  }

  @Get(':callUuid/trace')
  trace(@Param('callUuid') callUuid: string) {
    return this.callLogsService.getTrace(callUuid);
  }
}
