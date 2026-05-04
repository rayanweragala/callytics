import { promises as fs } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

let pool: Pool | null = null;

async function readTestDatabaseUrl(): Promise<string> {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  const envFile = join(__dirname, '.test-env.json');
  const raw = await fs.readFile(envFile, 'utf8');
  const parsed = JSON.parse(raw) as { TEST_DATABASE_URL?: string };
  if (!parsed.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set');
  }

  process.env.TEST_DATABASE_URL = parsed.TEST_DATABASE_URL;
  return parsed.TEST_DATABASE_URL;
}

export async function getTestDb(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  pool = new Pool({ connectionString: await readTestDatabaseUrl() });
  pool.on('error', () => undefined);
  return pool;
}

export async function closeTestDb(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

export async function truncateAll(): Promise<void> {
  const db = await getTestDb();
  const tables = [
    'flow_edges',
    'flow_nodes',
    'flow_versions',
    'call_flows',
    'audio_files',
    'sip_extensions',
    'inbound_routes',
    'sip_trunks',
    'call_recordings',
    'call_node_logs',
    'call_logs',
    'call_sessions',
  ];

  const existingRows = await db.query<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name ASC
    `,
    [tables],
  );

  const existingTables = existingRows.rows.map((row) => row.table_name);
  if (existingTables.length === 0) {
    return;
  }

  await db.query(`TRUNCATE ${existingTables.join(', ')} RESTART IDENTITY CASCADE`);
}
