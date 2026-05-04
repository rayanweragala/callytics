import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { CreateInboundRouteDto } from './dto/create-inbound-route.dto';
import { UpdateInboundRouteDto } from './dto/update-inbound-route.dto';
import { InboundRoutesService } from './inbound-routes.service';

@Controller('inbound-routes')
export class InboundRoutesController {
  constructor(private readonly inboundRoutesService: InboundRoutesService) {}

  @Get()
  list(
    @Query('did') did?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.inboundRoutesService.list(did, limit, offset);
  }

  @Post()
  create(@Body() dto: CreateInboundRouteDto) {
    return this.inboundRoutesService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInboundRouteDto) {
    return this.inboundRoutesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.inboundRoutesService.remove(id);
  }
}
