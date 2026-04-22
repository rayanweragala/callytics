import { Controller, DefaultValuePipe, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { DiagnosticsService } from './diagnostics.service';

@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @Get('health')
  getHealth() {
    return this.diagnosticsService.getSystemHealth();
  }

  @Post('trunks/:id/test')
  @HttpCode(200)
  testTrunk(@Param('id', ParseIntPipe) id: number) {
    return this.diagnosticsService.testTrunk(id);
  }

  @Post('trunks/test-all')
  @HttpCode(200)
  testAllTrunks() {
    return this.diagnosticsService.testAllTrunks();
  }

  @Get('registrations')
  getRegistrations() {
    return this.diagnosticsService.getSipRegistrations();
  }

  @Get('failures')
  getFailures(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.diagnosticsService.getRecentFailures(limit, offset);
  }

  @Get('sip-messages')
  getSipMessages(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('callId') callId?: string,
  ) {
    return this.diagnosticsService.getSipMessages(page, limit, callId);
  }

  @Get('sip-messages/:callId')
  getSipMessagesByCallId(@Param('callId') callId: string) {
    return this.diagnosticsService.getSipMessagesByCallId(callId);
  }
}
