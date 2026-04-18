import pool from './db';

export default async function migrate(): Promise<void> {
  const tables = [
    {
      name: 'call_flows',
      sql: `
        CREATE TABLE IF NOT EXISTS call_flows (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          slug VARCHAR(255) UNIQUE NOT NULL,
          description TEXT,
          status VARCHAR(50) DEFAULT 'draft',
          entry_type VARCHAR(50) DEFAULT 'default',
          entry_value VARCHAR(255),
          current_version_id INTEGER,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `,
    },
    {
      name: 'flow_versions',
      sql: `
        CREATE TABLE IF NOT EXISTS flow_versions (
          id SERIAL PRIMARY KEY,
          flow_id INTEGER REFERENCES call_flows(id),
          version_number INTEGER NOT NULL,
          is_published BOOLEAN DEFAULT false,
          published_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `,
    },
    {
      name: 'flow_nodes',
      sql: `
        CREATE TABLE IF NOT EXISTS flow_nodes (
          id SERIAL PRIMARY KEY,
          flow_version_id INTEGER REFERENCES flow_versions(id),
          node_key VARCHAR(255) NOT NULL,
          type VARCHAR(100) NOT NULL,
          label VARCHAR(255),
          position_x FLOAT DEFAULT 0,
          position_y FLOAT DEFAULT 0,
          config_json JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `,
    },
    {
      name: 'flow_edges',
      sql: `
        CREATE TABLE IF NOT EXISTS flow_edges (
          id SERIAL PRIMARY KEY,
          flow_version_id INTEGER REFERENCES flow_versions(id),
          source_node_key VARCHAR(255) NOT NULL,
          target_node_key VARCHAR(255) NOT NULL,
          branch_key VARCHAR(100) DEFAULT 'default',
          condition VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `,
    },
    {
      name: 'call_logs',
      sql: `
        CREATE TABLE IF NOT EXISTS call_logs (
          id SERIAL PRIMARY KEY,
          call_uuid VARCHAR(255) UNIQUE NOT NULL,
          direction VARCHAR(50) DEFAULT 'inbound',
          caller_number VARCHAR(100),
          callee_number VARCHAR(100),
          started_at TIMESTAMP DEFAULT NOW(),
          answered_at TIMESTAMP,
          ended_at TIMESTAMP,
          end_reason VARCHAR(100),
          duration_seconds INTEGER,
          talk_seconds INTEGER,
          flow_id INTEGER,
          flow_version_id INTEGER,
          entry_node_key VARCHAR(255),
          exit_node_key VARCHAR(255)
        )
      `,
    },
    {
      name: 'call_node_logs',
      sql: `
        CREATE TABLE IF NOT EXISTS call_node_logs (
          id SERIAL PRIMARY KEY,
          call_uuid TEXT NOT NULL,
          flow_id INTEGER NOT NULL REFERENCES call_flows(id),
          node_key TEXT NOT NULL,
          node_type TEXT NOT NULL,
          entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          exited_at TIMESTAMPTZ,
          exit_branch TEXT,
          error_message TEXT
        )
      `,
    },
  ];

  await pool.query('SELECT 1');

  for (const table of tables) {
    await pool.query(table.sql);
    console.log(`Checked table: ${table.name}`);
  }

  await pool.query(`ALTER TABLE flow_edges ADD COLUMN IF NOT EXISTS condition VARCHAR(100)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_node_logs_call_uuid ON call_node_logs(call_uuid)`);
  await pool.query(`
    ALTER TABLE call_recordings
    ADD COLUMN IF NOT EXISTS recording_type TEXT NOT NULL DEFAULT 'inbound',
    ADD COLUMN IF NOT EXISTS call_log_id INTEGER
  `).catch(() => undefined);
  await pool.query(`
    ALTER TABLE call_flows
    ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS template_description TEXT,
    ADD COLUMN IF NOT EXISTS template_category TEXT
  `);

  console.log('Tables checked successfully');
}
