import { promises as fs } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';

export async function runSqlMigrations(dataSource: DataSource): Promise<void> {
  const migrationsDir = join(process.cwd(), 'src', 'db', 'migrations');
  let files: string[] = [];

  try {
    files = await fs.readdir(migrationsDir);
  } catch {
    return;
  }

  const sqlFiles = files
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  for (const file of sqlFiles) {
    const sql = await fs.readFile(join(migrationsDir, file), 'utf8');
    const statements = sql
      .split(/;\s*(?:\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await dataSource.query(statement);
    }
  }
}
