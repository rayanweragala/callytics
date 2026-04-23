import { Controller, Get, HttpCode, Post } from '@nestjs/common';
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
  history() {
    return this.preflightService.history();
  }
}
