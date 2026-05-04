import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CallbacksService } from './callbacks.service';

@Controller('callbacks')
export class CallbacksController {
  constructor(private readonly callbacksService: CallbacksService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) {
    return this.callbacksService.listCallbacks({ page, limit, status });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.callbacksService.getCallback(id);
  }

  @Post(':id/execute')
  execute(@Param('id', ParseIntPipe) id: number) {
    return this.callbacksService.executeCallback(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.callbacksService.cancelCallback(id);
  }
}
