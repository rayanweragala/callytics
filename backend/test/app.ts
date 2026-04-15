import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { URL } from 'url';
import { AppModule } from '../src/app.module';
import { AsteriskConfigService } from '../src/asterisk/asterisk-config.service';
import { DiagnosticsService } from '../src/diagnostics/diagnostics.service';

class FakeAsteriskConfigService {
  async onModuleInit(): Promise<void> {}
  async writeExtensionsConfig(): Promise<void> {}
  async writeTrunksConfig(): Promise<void> {}
  async writeInboundRoutesConfig(): Promise<void> {}
  async syncExtensions(): Promise<void> {}
  async syncInboundRoutes(): Promise<void> {}
  async reloadResPjsip(): Promise<void> {}
  async reloadDialplan(): Promise<void> {}
}

class FakeDiagnosticsService {
  setGateway(): void {}
  async onModuleInit(): Promise<void> {}
  getSnapshot() { return { metrics: { activeCalls: 0, registeredEndpoints: 0, flows: 0, uptimeSeconds: 0 }, sipStatuses: [], timeline: {} }; }
  listTimelineCalls() { return { data: [], total: 0 }; }
  listSipStatuses() { return { data: [], total: 0 }; }
  getSipStatuses() { return []; }
  getMetrics() { return { activeCalls: 0, registeredEndpoints: 0, flows: 0, uptimeSeconds: 0 }; }
  getTimelineForCall() { return undefined; }
}

let app: INestApplication | null = null;

function applyTestDatabaseEnv(): void {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is not set');
  }

  const parsed = new URL(testDatabaseUrl);
  process.env.DB_HOST = parsed.hostname;
  process.env.DB_PORT = parsed.port || '5432';
  process.env.DB_NAME = parsed.pathname.replace(/^\//, '');
  process.env.DB_USER = decodeURIComponent(parsed.username);
  process.env.DB_PASS = decodeURIComponent(parsed.password);
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '0';
  process.env.ASTERISK_CONFIG_DIR = '/tmp/callytics-test-asterisk';
}

export async function getApp(): Promise<INestApplication> {
  if (app) {
    return app;
  }

  applyTestDatabaseEnv();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AsteriskConfigService)
    .useClass(FakeAsteriskConfigService)
    .overrideProvider(DiagnosticsService)
    .useClass(FakeDiagnosticsService)
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  return app;
}

export async function closeApp(): Promise<void> {
  if (!app) {
    return;
  }

  await app.close();
  app = null;
}
