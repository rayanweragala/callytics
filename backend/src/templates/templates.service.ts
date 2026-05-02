import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class TemplatesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async listTemplates() {
    const rows = await this.dataSource.query(
      `
        SELECT
          cf.id,
          cf.name,
          cf.description,
          cf.template_description AS "templateDescription",
          cf.template_category AS "templateCategory",
          COALESCE(fv.node_count, node_counts.node_count, 0) AS "nodeCount"
        FROM call_flows cf
        LEFT JOIN flow_versions fv ON fv.id = cf.current_version_id
        LEFT JOIN (
          SELECT flow_version_id, COUNT(*)::int AS node_count
          FROM flow_nodes
          GROUP BY flow_version_id
        ) node_counts ON node_counts.flow_version_id = cf.current_version_id
        WHERE cf.is_template = true
        ORDER BY cf.created_at DESC, cf.id DESC
      `,
    );

    return {
      data: rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        name: String(row.name || ''),
        description: row.description ? String(row.description) : null,
        templateDescription: row.templateDescription ? String(row.templateDescription) : null,
        templateCategory: row.templateCategory ? String(row.templateCategory) : null,
        nodeCount: Number(row.nodeCount || 0),
      })),
    };
  }

  async importTemplate(templateId: number): Promise<{ id: number; name: string }> {
    return this.dataSource.transaction(async (manager) => {
      const templateRows = await manager.query(
        `
          SELECT *
          FROM call_flows
          WHERE id = $1
            AND is_template = true
          LIMIT 1
        `,
        [templateId],
      );

      const template = templateRows[0] as Record<string, unknown> | undefined;
      if (!template) {
        throw new NotFoundException(`Template ${templateId} not found`);
      }

      const currentVersionId = Number(template.current_version_id || 0);
      if (currentVersionId <= 0) {
        throw new NotFoundException(`Template ${templateId} has no active version`);
      }

      const copyName = `${String(template.name || 'Template')} (copy)`;
      const baseSlug = `${String(template.slug || 'template')}-copy`;
      const slug = await this.ensureUniqueSlug(manager, baseSlug);

      const insertedFlowRows = await manager.query(
        `
          INSERT INTO call_flows (
            name,
            slug,
            description,
            status,
            entry_type,
            entry_value,
            parent_flow_id,
            parent_node_key,
            is_template,
            template_description,
            template_category,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'draft', 'default', NULL, NULL, NULL, false, NULL, NULL, NOW(), NOW())
          RETURNING id, name
        `,
        [copyName, slug, template.description || null],
      );

      const newFlow = insertedFlowRows[0] as { id: number; name: string };

      const insertedVersionRows = await manager.query(
        `
          INSERT INTO flow_versions (
            flow_id,
            version_number,
            is_published,
            published_at,
            created_at,
            message,
            node_count,
            snapshot
          )
          SELECT
            $1,
            1,
            false,
            NULL,
            NOW(),
            'Imported from template #' || $2::text,
            fv.node_count,
            fv.snapshot
          FROM flow_versions fv
          WHERE fv.id = $3
          RETURNING id
        `,
        [newFlow.id, templateId, currentVersionId],
      );

      const newVersionId = Number(insertedVersionRows[0]?.id || 0);

      await manager.query(
        `
          INSERT INTO flow_nodes (
            flow_version_id,
            node_key,
            type,
            label,
            position_x,
            position_y,
            config_json,
            group_id,
            subflow_id,
            created_at
          )
          SELECT
            $1,
            fn.node_key,
            fn.type,
            fn.label,
            fn.position_x,
            fn.position_y,
            fn.config_json,
            fn.group_id,
            NULL,
            NOW()
          FROM flow_nodes fn
          WHERE fn.flow_version_id = $2
        `,
        [newVersionId, currentVersionId],
      );

      await manager.query(
        `
          INSERT INTO flow_edges (
            flow_version_id,
            source_node_key,
            target_node_key,
            branch_key,
            condition,
            created_at
          )
          SELECT
            $1,
            fe.source_node_key,
            fe.target_node_key,
            fe.branch_key,
            fe.condition,
            NOW()
          FROM flow_edges fe
          WHERE fe.flow_version_id = $2
        `,
        [newVersionId, currentVersionId],
      );

      await manager.query(
        `
          UPDATE call_flows
          SET current_version_id = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [newFlow.id, newVersionId],
      );

      return { id: Number(newFlow.id), name: String(newFlow.name) };
    });
  }

  private async ensureUniqueSlug(manager: DataSource['manager'], baseSlug: string): Promise<string> {
    const normalizedBase = baseSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      || 'template-copy';

    let candidate = normalizedBase;
    let suffix = 2;

    while (true) {
      const rows = await manager.query(`SELECT id FROM call_flows WHERE slug = $1 LIMIT 1`, [candidate]);
      if (!rows[0]) {
        return candidate;
      }
      candidate = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
  }
}
