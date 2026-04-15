import { promises as fs } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const TEST_DB_NAME = 'callytics_test';
const ENV_FILE = join(__dirname, '.test-env.json');

function buildAdminConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'callytics',
    password: process.env.DB_PASS || process.env.POSTGRES_PASSWORD || 'callytics',
    database: process.env.POSTGRES_DB || process.env.DB_NAME || process.env.DB_ADMIN_NAME || 'postgres',
  };
}

export default async function globalTeardown(): Promise<void> {
  const adminPool = new Pool(buildAdminConfig());
  try {
    await adminPool.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [TEST_DB_NAME],
    );
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
  } finally {
    await adminPool.end();
  }

  try {
    await fs.unlink(ENV_FILE);
  } catch {}
}
