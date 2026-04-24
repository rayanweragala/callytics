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

async function runSqlFiles(pool: Pool): Promise<void> {
  const candidates = [
    join(__dirname, '..', 'migrations'),
    join(__dirname, '..', 'src', 'db', 'migrations'),
  ];

  let migrationsDir: string | null = null;
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        migrationsDir = candidate;
        break;
      }
    } catch {
      // Keep scanning candidates.
    }
  }

  if (!migrationsDir) {
    throw new Error(`No migrations directory found. Checked: ${candidates.join(', ')}`);
  }

  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  for (const file of files) {
    const sql = await fs.readFile(join(migrationsDir, file), 'utf8');
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await pool.query(statement);
    }
  }
}

export default async function globalSetup(): Promise<void> {
  const adminConfig = buildAdminConfig();
  const adminPool = new Pool(adminConfig);

  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    await adminPool.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await adminPool.end();
  }

  const testDatabaseUrl = `postgresql://${encodeURIComponent(adminConfig.user)}:${encodeURIComponent(adminConfig.password)}@${adminConfig.host}:${adminConfig.port}/${TEST_DB_NAME}`;
  process.env.TEST_DATABASE_URL = testDatabaseUrl;
  await fs.writeFile(ENV_FILE, JSON.stringify({ TEST_DATABASE_URL: testDatabaseUrl }, null, 2));

  const testPool = new Pool({ connectionString: testDatabaseUrl });
  try {
    await runSqlFiles(testPool);
  } finally {
    await testPool.end();
  }
}
