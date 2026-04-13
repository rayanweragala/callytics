// NOTE: This seed flow uses built-in Asterisk sound file paths directly
// for testing. In production flows the config will reference audio_file_id
// from the audio_files table and the runtime will resolve the actual path.

import pool, { query } from './db';

export default async function seed(): Promise<void> {
  const existing = await query(
    `SELECT id FROM call_flows WHERE status = 'published' LIMIT 1`
  );

  if (existing.length > 0) {
    console.log('Seed flow already exists, skipping');
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const flowResult = await client.query(
      `
        INSERT INTO call_flows (
          name, slug, description, status, entry_type
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `,
      [
        'Test Flow',
        'test-flow',
        'Auto-generated seed flow for testing',
        'published',
        'default',
      ],
    );

    const flowId = flowResult.rows[0].id;

    const versionResult = await client.query(
      `
        INSERT INTO flow_versions (
          flow_id, version_number, is_published, published_at
        ) VALUES ($1, $2, $3, NOW())
        RETURNING id
      `,
      [flowId, 1, true],
    );

    const versionId = versionResult.rows[0].id;

    await client.query(
      `UPDATE call_flows SET current_version_id = $1 WHERE id = $2`,
      [versionId, flowId],
    );

    const nodes = [
      { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
      {
        node_key: 'greet',
        type: 'play_audio',
        label: 'Greeting',
        config_json: { audio_file_path: 'tt-monkeys' },
      },
      {
        node_key: 'menu',
        type: 'get_digits',
        label: 'Main Menu',
        config_json: { prompt_path: 'tt-weasels', timeout_ms: 5000 },
      },
      { node_key: 'bye', type: 'hangup', label: 'Goodbye', config_json: {} },
    ];

    for (const node of nodes) {
      await client.query(
        `
          INSERT INTO flow_nodes (
            flow_version_id, node_key, type, label, config_json
          ) VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        [versionId, node.node_key, node.type, node.label, JSON.stringify(node.config_json)],
      );
    }

    const edges = [
      ['start', 'greet', 'default'],
      ['greet', 'menu', 'default'],
      ['menu', 'bye', '1'],
      ['menu', 'bye', '2'],
      ['menu', 'bye', 'timeout'],
      ['menu', 'bye', 'default'],
    ];

    for (const [source, target, branch] of edges) {
      await client.query(
        `
          INSERT INTO flow_edges (
            flow_version_id, source_node_key, target_node_key, branch_key
          ) VALUES ($1, $2, $3, $4)
        `,
        [versionId, source, target, branch],
      );
    }

    await client.query('COMMIT');
    console.log('Seed flow inserted successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
