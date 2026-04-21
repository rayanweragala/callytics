import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { CreateContactNumberDto } from './dto/create-contact-number.dto';
import { UpdateContactNumberDto } from './dto/update-contact-number.dto';
import { ContactNumbersService } from './contact-numbers.service';

@Controller('contact-numbers')
export class ContactNumbersController {
  constructor(private readonly contactNumbersService: ContactNumbersService) {}

  @Get()
  list() {
    return this.contactNumbersService.list();
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
