import { stasisLogger } from "./logger";
// NOTE: This seed flow uses built-in Asterisk sound file paths directly
// for testing. In production flows the config will reference audio_file_id
// from the audio_files table and the runtime will resolve the actual path.

import pool, { query } from './db';

export default async function seed(): Promise<void> {
  const seedSlug = 'test-flow';

  const existingFlowRows = await query(
    `
      SELECT cf.id, cf.current_version_id, COUNT(fn.id)::int AS node_count
      FROM call_flows cf
      LEFT JOIN flow_nodes fn ON fn.flow_version_id = cf.current_version_id
      WHERE cf.slug = $1
      GROUP BY cf.id, cf.current_version_id
      LIMIT 1
    `,
    [seedSlug],
  );

  const existingFlow = existingFlowRows[0] as {
    id: number;
    current_version_id: number | null;
    node_count: number;
  } | undefined;

  if (existingFlow && existingFlow.node_count > 0) {
    stasisLogger.log(`Flow ${seedSlug} already exists with ${existingFlow.node_count} nodes, skipping seed`);
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
        ON CONFLICT (slug) DO UPDATE
        SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          entry_type = EXCLUDED.entry_type,
          updated_at = NOW()
        RETURNING id
      `,
      [
        'Test Flow',
        seedSlug,
        'Auto-generated seed flow for testing',
        'published',
        'default',
      ],
    );

    const flowId = flowResult.rows[0].id;

    let versionId: number;

    if (existingFlow?.current_version_id) {
      versionId = existingFlow.current_version_id;
    } else {
      const versionResult = await client.query(
        `
          INSERT INTO flow_versions (
            flow_id, version_number, is_published, published_at
          ) VALUES ($1, $2, $3, NOW())
          RETURNING id
        `,
        [flowId, 1, true],
      );

      versionId = versionResult.rows[0].id;

      await client.query(
        `UPDATE call_flows SET current_version_id = $1 WHERE id = $2`,
        [versionId, flowId],
      );
    }

    const versionNodeCountResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM flow_nodes WHERE flow_version_id = $1`,
      [versionId],
    );
    const versionNodeCount = Number(versionNodeCountResult.rows[0]?.count || 0);

    if (versionNodeCount > 0) {
      await client.query('COMMIT');
      stasisLogger.log(`Seed flow ${seedSlug} already has ${versionNodeCount} nodes, skipping insert`);
      return;
    }

    const nodes = [
      { node_key: 'start', type: 'start', label: 'Start', config_json: {} },
      {
        node_key: 'greet',
        type: 'play_audio',
        label: 'Greeting',
        config_json: { audio_file_id: '2', audio_file_path: 'tt-monkeys' },
      },
      {
        node_key: 'menu',
        type: 'menu',
        label: 'Main Menu',
        config_json: {
          prompt_audio_file_id: 1,
          prompt_path: 'tt-weasels',
          timeout_ms: 5000,
          branches: ['1', '2'],
          max_timeout_attempts: 3,
          max_invalid_attempts: 3,
          timeout_prompt_audio_id: null,
          timeout_prompt_path: null,
          invalid_prompt_audio_id: null,
          invalid_prompt_path: null,
          final_failure_audio_id: null,
          final_failure_path: null,
        },
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
      ['start', 'greet', 'default', null],
      ['greet', 'menu', 'default', null],
      ['menu', 'bye', '1', '1'],
      ['menu', 'bye', '2', '2'],
      ['menu', 'bye', 'timeout', 'timeout'],
      ['menu', 'bye', 'default', 'default'],
    ];

    for (const [source, target, branch, condition] of edges) {
      await client.query(
        `
          INSERT INTO flow_edges (
            flow_version_id, source_node_key, target_node_key, branch_key, condition
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [versionId, source, target, branch, condition],
      );
    }

    await client.query('COMMIT');
    stasisLogger.log(`Seed flow ${seedSlug} inserted successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
