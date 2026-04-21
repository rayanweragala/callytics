import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperatorEntity } from './entities/operator.entity';
import { OperatorsController } from './operators.controller';
import { OperatorsService } from './operators.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperatorEntity])],
  controllers: [OperatorsController],
  providers: [OperatorsService],
  exports: [OperatorsService],
})
export class OperatorsModule implements OnModuleInit {
  constructor(private readonly operatorsService: OperatorsService) {}

  async onModuleInit(): Promise<void> {
    await this.operatorsService.onModuleInit();
  }
}
