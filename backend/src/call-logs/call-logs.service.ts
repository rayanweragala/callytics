import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface ListCallLogsParams {
  page?: number;
  limit?: number;
  search?: string;
  endReason?: string;
  dateFrom?: string;
  dateTo?: string;
  direction?: string;
  callLogId?: string;
}

interface TraceNode {
  id: number;
  nodeKey: string;
  nodeType: string;
  enteredAt: string;
  exitedAt: string | null;
  durationMs: number | null;
  exitBranch: string | null;
  errorMessage: string | null;
}

@Injectable()
export class CallLogsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(params: ListCallLogsParams) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(100, Math.max(1, Number(params.limit || 25)));
    const offset = (page - 1) * limit;

    const whereParts: string[] = [];
    const queryParams: unknown[] = [];

    if (params.search?.trim()) {
      queryParams.push(`%${params.search.trim()}%`);
      whereParts.push(`cl.caller_number ILIKE $${queryParams.length}`);
    }

    if (params.endReason?.trim()) {
      queryParams.push(params.endReason.trim());
      whereParts.push(`cl.end_reason = $${queryParams.length}`);
    }

    if (params.dateFrom?.trim()) {
      queryParams.push(params.dateFrom.trim());
      whereParts.push(`cl.started_at >= $${queryParams.length}::timestamptz`);
    }

    if (params.dateTo?.trim()) {
      queryParams.push(params.dateTo.trim());
      whereParts.push(`cl.started_at <= $${queryParams.length}::timestamptz`);
    }

    if (params.direction?.trim()) {
      queryParams.push(params.direction.trim());
      whereParts.push(`cl.direction = $${queryParams.length}`);
    }

    if (params.callLogId?.trim()) {
      const callLogId = Number(params.callLogId);
      if (Number.isFinite(callLogId)) {
        queryParams.push(callLogId);
        whereParts.push(`cl.id = $${queryParams.length}`);
      }
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countRows = await this.dataSource.query(
      `
        SELECT COUNT(*)::int AS total
        FROM call_logs cl
        ${whereSql}
      `,
      queryParams,
    );

    queryParams.push(limit);
    queryParams.push(offset);

    const dataRows = await this.dataSource.query(
      `
        SELECT
          cl.id,
          cl.call_uuid AS "callUuid",
          cl.direction,
          cl.caller_number AS "callerNumber",
          cl.callee_number AS "calleeNumber",
          cl.started_at AS "startedAt",
          cl.answered_at AS "answeredAt",
          cl.ended_at AS "endedAt",
          cl.end_reason AS "endReason",
          cl.duration_seconds AS "durationSeconds",
          cl.talk_seconds AS "talkSeconds",
          cl.flow_id AS "flowId",
          cl.flow_version_id AS "flowVersionId",
          cl.entry_node_key AS "entryNodeKey",
          cl.exit_node_key AS "exitNodeKey",
          cf.name AS "flowName",
          camp.name AS "campaignName"
        FROM call_logs cl
        LEFT JOIN call_flows cf ON cf.id = cl.flow_id
        LEFT JOIN LATERAL (
          SELECT c.name
          FROM campaign_contact_attempts cca
          LEFT JOIN campaigns c ON c.id = cca.campaign_id
          WHERE cca.call_log_id = cl.id
          ORDER BY cca.id DESC
          LIMIT 1
        ) camp ON true
        ${whereSql}
        ORDER BY cl.started_at DESC
        LIMIT $${queryParams.length - 1}
        OFFSET $${queryParams.length}
      `,
      queryParams,
    );

    return {
      data: dataRows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        callUuid: String(row.callUuid || ''),
        direction: String(row.direction || ''),
        callerNumber: row.callerNumber ? String(row.callerNumber) : null,
        calleeNumber: row.calleeNumber ? String(row.calleeNumber) : null,
        startedAt: row.startedAt ? new Date(String(row.startedAt)).toISOString() : null,
        answeredAt: row.answeredAt ? new Date(String(row.answeredAt)).toISOString() : null,
        endedAt: row.endedAt ? new Date(String(row.endedAt)).toISOString() : null,
        endReason: row.endReason ? String(row.endReason) : null,
        durationSeconds: row.durationSeconds === null ? null : Number(row.durationSeconds),
        talkSeconds: row.talkSeconds === null ? null : Number(row.talkSeconds),
        flowId: row.flowId === null ? null : Number(row.flowId),
        flowVersionId: row.flowVersionId === null ? null : Number(row.flowVersionId),
        entryNodeKey: row.entryNodeKey ? String(row.entryNodeKey) : null,
        exitNodeKey: row.exitNodeKey ? String(row.exitNodeKey) : null,
        flowName: row.flowName ? String(row.flowName) : null,
        campaignName: row.campaignName ? String(row.campaignName) : null,
      })),
      total: Number(countRows[0]?.total || 0),
      page,
      limit,
    };
  }

  async getTrace(callUuid: string): Promise<{ callUuid: string; callerNumber: string | null; startTime: string | null; nodes: TraceNode[] }> {
    const headerRows = await this.dataSource.query(
      `
        SELECT call_uuid AS "callUuid", caller_number AS "callerNumber", started_at AS "startedAt"
        FROM call_logs
        WHERE call_uuid = $1
        ORDER BY id DESC
        LIMIT 1
      `,
      [callUuid],
    );

    const nodeRows = await this.dataSource.query(
      `
        SELECT
          id,
          node_key AS "nodeKey",
          node_type AS "nodeType",
          entered_at AS "enteredAt",
          exited_at AS "exitedAt",
          exit_branch AS "exitBranch",
          error_message AS "errorMessage"
        FROM call_node_logs
        WHERE call_uuid = $1
        ORDER BY entered_at ASC, id ASC
      `,
      [callUuid],
    );

    const header = headerRows[0] as Record<string, unknown> | undefined;

    const nodes = nodeRows.map((row: Record<string, unknown>) => {
      const enteredAtDate = row.enteredAt ? new Date(String(row.enteredAt)) : null;
      const exitedAtDate = row.exitedAt ? new Date(String(row.exitedAt)) : null;
      return {
        id: Number(row.id),
        nodeKey: String(row.nodeKey || ''),
        nodeType: String(row.nodeType || ''),
        enteredAt: enteredAtDate ? enteredAtDate.toISOString() : new Date(0).toISOString(),
        exitedAt: exitedAtDate ? exitedAtDate.toISOString() : null,
        durationMs: enteredAtDate && exitedAtDate ? Math.max(0, exitedAtDate.getTime() - enteredAtDate.getTime()) : null,
        exitBranch: row.exitBranch ? String(row.exitBranch) : null,
        errorMessage: row.errorMessage ? String(row.errorMessage) : null,
      };
    });

    return {
      callUuid,
      callerNumber: header?.callerNumber ? String(header.callerNumber) : null,
      startTime: header?.startedAt ? new Date(String(header.startedAt)).toISOString() : null,
      nodes,
    };
  }
}
