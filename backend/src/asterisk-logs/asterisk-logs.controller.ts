import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { AsteriskLogsService } from './asterisk-logs.service';

@Controller('asterisk/logs')
export class AsteriskLogsController {
  constructor(private readonly asteriskLogsService: AsteriskLogsService) {}

  @Get()
  getLogs(
    @Query('level', new DefaultValuePipe('all')) level: string,
    @Query('search', new DefaultValuePipe('')) search: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.asteriskLogsService.getLogs(level, search, limit, offset);
  }
}
