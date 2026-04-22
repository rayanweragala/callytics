# Architecture

## Call Execution Tracing
Every node visited during a call is logged to `call_node_logs`:
- Written by stasis runtime on node enter and exit
- Columns: `call_uuid`, `flow_id`, `node_key`, `node_type`, `entered_at`, `exited_at`, `exit_branch`, `error_message`
- Backend exposes `GET /call-logs/:callUuid/trace`
- Frontend renders a slide-in ExecutionTracePanel on row click in CallLogsPage and DiagnosticsPage Panel E

## Phase 22A architecture updates (current state)

### Call timeline relay path
- Stasis publishes per-node events to Redis channel `callytics:call-timeline`
- `DiagnosticsService` subscribes and validates timeline payloads
- `DiagnosticsGateway.broadcastCallTimelineEvent()` emits `call:timeline` to socket rooms
- `CallLogsPage` and live execution UI consume timeline events with lifecycle fallback

### DiagnosticsGateway initialization fix
- `DiagnosticsGateway` now registers itself in `afterInit()` via `diagnosticsService.setGateway(this)`
- This avoids constructor-time registration before `@WebSocketServer()` is attached
- Prevents silent no-op broadcasts when the server reference is not ready yet

### CallLogsListener Redis guard
- `CallLogsListener` now starts only when `REDIS_PORT` is configured and valid
- On missing/invalid Redis port or failed connect, backend logs warning and continues startup
- This prevents hard boot failures in environments where Redis is not reachable

## Phase 22B architecture updates (SIP Capture)

### Capture ingest and stream
- `tshark` now runs inside the Asterisk container via a dedicated capture sidecar process
- Sidecar command: `tshark -i any -f "udp port ${TSHARK_PORT}" -T ek -l`
- `TSHARK_PORT` is configured on the `asterisk` service (default `5060`, currently `5080` to match `pjsip.conf`)
- Sidecar normalizes SIP fields and writes packets to Redis stream `callytics:sip-capture` using `XADD` + `XTRIM` (`maxlen 500`)
- Sidecar is guarded by `TSHARK_ENABLED === "true"` in the Asterisk container environment

### Gateway extension (no regression to existing traffic stream)
- Existing `sip:traffic` event path remains unchanged
- Backend consumes Redis stream data only; it no longer spawns tshark
- `DiagnosticsGateway` publishes SIP capture packets via `sip:packet` into `capture-room`
- On room join/reconnect, last 500 packets are replayed from Redis stream (`XRANGE`/`XREVRANGE`)

### Capture export API
- New `CaptureController` provides:
  - `GET /capture/export/dialog/:callId`
  - `GET /capture/export/bulk`
- Exports are generated in-memory using `pcap-writer` and streamed directly (no disk write)
