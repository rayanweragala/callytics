import { Body, Controller, DefaultValuePipe, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateContactNumberDto } from './dto/create-contact-number.dto';
import { UpdateContactNumberDto } from './dto/update-contact-number.dto';
import { ContactNumbersService } from './contact-numbers.service';

@Controller('contact-numbers')
export class ContactNumbersController {
  constructor(private readonly contactNumbersService: ContactNumbersService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.contactNumbersService.findAll(page, limit);
  }

  @Post()
  create(@Body() dto: CreateContactNumberDto) {
    return this.contactNumbersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContactNumberDto) {
    return this.contactNumbersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.contactNumbersService.remove(id);
  }
}
