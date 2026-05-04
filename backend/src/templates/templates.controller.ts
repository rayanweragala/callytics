import { Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  listTemplates() {
    return this.templatesService.listTemplates();
  }

  @Post(':id/import')
  async importTemplate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.templatesService.importTemplate(id);
    return { data };
  }
}
