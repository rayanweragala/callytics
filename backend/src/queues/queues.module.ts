import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueEntity } from './entities/queue.entity';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';

@Module({
  imports: [TypeOrmModule.forFeature([QueueEntity])],
  controllers: [QueuesController],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class QueuesModule implements OnModuleInit {
  constructor(private readonly queuesService: QueuesService) {}

  async onModuleInit(): Promise<void> {
    await this.queuesService.onModuleInit();
  }
}
