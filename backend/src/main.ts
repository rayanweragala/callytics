import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });
  const port = Number(process.env.BACKEND_PORT || 3001);

  await app.listen(port);
  Logger.log(`callytics backend running on port ${port}`);
}

void bootstrap();
