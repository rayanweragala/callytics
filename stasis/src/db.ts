import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'callytics',
  user: process.env.DB_USER || 'callytics',
  password: process.env.DB_PASS || 'callytics',
});

export async function query(sql: string, params?: readonly unknown[]) {
  const result = await pool.query(sql, params as unknown[]);
  return result.rows;
}

export default pool;
