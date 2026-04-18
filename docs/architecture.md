# Architecture

## Call Execution Tracing
Every node visited during a call is logged to `call_node_logs`:
- Written by stasis runtime on node enter and exit
- Columns: `call_uuid`, `flow_id`, `node_key`, `node_type`, `entered_at`, `exited_at`, `exit_branch`, `error_message`
- Backend exposes `GET /call-logs/:callUuid/trace`
- Frontend renders a slide-in ExecutionTracePanel on row click in CallLogsPage and DiagnosticsPage Panel E
