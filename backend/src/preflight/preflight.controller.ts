import { Controller, DefaultValuePipe, Get, HttpCode, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PreflightService } from './preflight.service';

@Controller('preflight')
export class PreflightController {
  constructor(private readonly preflightService: PreflightService) {}

  @Post('run')
  @HttpCode(200)
  run() {
    return this.preflightService.run();
  }

  @Get('history')
  history(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.preflightService.history(page, limit);
  }
}
