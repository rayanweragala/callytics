import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDeliveryEntity } from './entities/webhook-delivery.entity';
import { WebhooksController } from './webhooks.controller';
import { WebhooksListener } from './webhooks.listener';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDeliveryEntity])],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksListener],
  exports: [WebhooksService],
})
export class WebhooksModule {}
