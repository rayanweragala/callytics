import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowDto } from './dto/update-flow.dto';
import { FlowsService } from './flows.service';

@Controller('flows')
export class FlowsController {
  constructor(private readonly flowsService: FlowsService) {}

  @Get()
  findAll() {
    return this.flowsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.flowsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFlowDto) {
    return this.flowsService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFlowDto) {
    return this.flowsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.flowsService.remove(id);
  }
}
