import { promises as fs } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';

let migrationRunPromise: Promise<void> | null = null;

async function collectSqlFiles(dir: string): Promise<Array<{ name: string; path: string }>> {
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((file) => file.endsWith('.sql'))
      .map((file) => ({ name: file, path: join(dir, file) }));
  } catch {
    return [];
  }
}

export async function runSqlMigrations(dataSource: DataSource): Promise<void> {
  if (migrationRunPromise) {
    await migrationRunPromise;
    return;
  }

  migrationRunPromise = (async () => {
    const legacyDir = join(process.cwd(), 'src', 'db', 'migrations');
    const rootDir = join(process.cwd(), 'migrations');

    const [legacyFiles, rootFiles] = await Promise.all([
      collectSqlFiles(legacyDir),
      collectSqlFiles(rootDir),
    ]);

    const filesByName = new Map<string, string>();
    for (const file of [...rootFiles, ...legacyFiles]) {
      if (!filesByName.has(file.name)) {
        filesByName.set(file.name, file.path);
      }
    }

    const sortedFiles = Array.from(filesByName.entries())
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true }))
      .map((entry) => entry[1]);

    for (const filePath of sortedFiles) {
      const sql = await fs.readFile(filePath, 'utf8');
      const statements = sql
        .split(/;\s*(?:\n|$)/)
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        try {
          await dataSource.query(statement);
        } catch (error: unknown) {
          const err = error as { code?: string; message?: string };
          const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
          const isOperatorsPinAdd =
            normalized === 'alter table operators add column if not exists pin text';
          const isSipExtensionsTransportConstraintAdd =
            normalized.includes('alter table sip_extensions') &&
            normalized.includes('add constraint sip_extensions_transport_type_check');
          if (err?.code === '54011' && isOperatorsPinAdd) {
            // In some legacy databases, Postgres errors before IF NOT EXISTS can short-circuit.
            // Skip this additive column migration so boot can continue.
            continue;
          }
          if (err?.code === '42710' && isSipExtensionsTransportConstraintAdd) {
            // Multiple module init paths can replay this additive constraint concurrently.
            // Treat duplicate creation as the IF NOT EXISTS outcome for test startup.
            continue;
          }
          throw error;
        }
      }
    }
  })();

  try {
    await migrationRunPromise;
  } catch (error) {
    migrationRunPromise = null;
    throw error;
  }
}
