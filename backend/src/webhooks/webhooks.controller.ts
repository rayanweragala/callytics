import { Controller, DefaultValuePipe, Get, Param, Query } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhook-deliveries')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  list(
    @Query('flow_id') flowId?: string,
    @Query('node_id') nodeId?: string,
    @Query('success') success?: string,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
    @Query('page', new DefaultValuePipe(1)) page?: number,
    @Query('limit', new DefaultValuePipe(20)) limit?: number,
  ) {
    return this.webhooksService.getDeliveries({
      flow_id: flowId,
      node_id: nodeId,
      success,
      from_date: fromDate,
      to_date: toDate,
      page,
      limit,
    });
  }

  @Get('node/:nodeId')
  getNodeDeliveries(@Param('nodeId') nodeId: string) {
    return this.webhooksService.getNodeDeliveries(nodeId);
  }
}
