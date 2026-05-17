import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { runSqlMigrations } from './run-sql-migrations';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'callytics',
    username: process.env.DB_USER || 'callytics',
    password: process.env.DB_PASS || 'callytics',
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    await runSqlMigrations(dataSource);
    process.stdout.write('SQL migrations completed successfully\n');
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
