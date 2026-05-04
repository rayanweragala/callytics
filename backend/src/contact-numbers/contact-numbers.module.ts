import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactNumbersController } from './contact-numbers.controller';
import { ContactNumbersService } from './contact-numbers.service';
import { ContactNumberEntity } from './entities/contact-number.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactNumberEntity])],
  controllers: [ContactNumbersController],
  providers: [ContactNumbersService],
  exports: [ContactNumbersService],
})
export class ContactNumbersModule implements OnModuleInit {
  constructor(private readonly contactNumbersService: ContactNumbersService) {}

  async onModuleInit(): Promise<void> {
    await this.contactNumbersService.onModuleInit();
  }
}
