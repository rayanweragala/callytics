import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { CreateTrunkDto } from './dto/create-trunk.dto';
import { UpdateTrunkDto } from './dto/update-trunk.dto';
import { TrunksService } from './trunks.service';

@Controller('trunks')
export class TrunksController {
  constructor(private readonly trunksService: TrunksService) {}

  @Get()
  list(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.trunksService.list(limit, offset);
  }

  @Post()
  create(@Body() dto: CreateTrunkDto) {
    return this.trunksService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTrunkDto) {
    return this.trunksService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.trunksService.remove(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.trunksService.test(id);
  }
}
