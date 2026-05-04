import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { QualityService } from './quality.service';

@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  @Get(':callId')
  async getQuality(@Param('callId') callId: string) {
    const record = await this.qualityService.findByCallId(callId);
    if (!record) {
      throw new NotFoundException('No quality data for this call');
    }
    return record;
  }
}
