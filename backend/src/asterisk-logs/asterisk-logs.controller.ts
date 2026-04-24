import { Controller, DefaultValuePipe, Get, ParseBoolPipe, ParseIntPipe, Query } from '@nestjs/common';
import { AsteriskLogsService } from './asterisk-logs.service';

@Controller('asterisk/logs')
export class AsteriskLogsController {
  constructor(private readonly asteriskLogsService: AsteriskLogsService) {}

  @Get()
  getLogs(
    @Query('level', new DefaultValuePipe('all')) level: string,
    @Query('search', new DefaultValuePipe('')) search: string,
    @Query('hideNoise', new DefaultValuePipe(true), ParseBoolPipe) hideNoise: boolean,
    @Query('uniqueid', new DefaultValuePipe('')) uniqueid: string,
    @Query('from', new DefaultValuePipe('')) from: string,
    @Query('to', new DefaultValuePipe('')) to: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.asteriskLogsService.getLogs(level, search, hideNoise, uniqueid, from, to, limit, offset);
  }
}
