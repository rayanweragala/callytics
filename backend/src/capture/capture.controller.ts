import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CaptureService } from './capture.service';

@Controller('capture')
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Get('export/dialog/:callId')
  async exportDialog(@Param('callId') callId: string, @Res() res: Response): Promise<void> {
    const buffer = await this.captureService.exportDialogPcap(callId);
    res.setHeader('Content-Type', 'application/vnd.tcpdump.pcap');
    res.setHeader('Content-Disposition', `attachment; filename="callytics-dialog-${encodeURIComponent(callId)}.pcap"`);
    res.send(buffer);
  }

  @Get('export/bulk')
  async exportBulk(
    @Query('method') method: string | undefined,
    @Query('callId') callId: string | undefined,
    @Query('endpoint') endpoint: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.captureService.exportBulkPcap({ method, callId, endpoint, from, to });
    res.setHeader('Content-Type', 'application/vnd.tcpdump.pcap');
    res.setHeader('Content-Disposition', 'attachment; filename="callytics-capture-export.pcap"');
    res.send(buffer);
  }
}
