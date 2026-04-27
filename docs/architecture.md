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

## Phase 23 architecture updates (RTP quality monitor)

### Redis Streams
- `callytics:call-timeline`    Phase 22A — call execution steps per channel
- `callytics:sip-capture`      Phase 22B — raw SIP packets from tshark
- `callytics:rtp-quality`      Phase 23  — per-call RTP quality (jitter, loss, MOS, RTT)

### Backend Modules
- `QualityModule`    Consumes `callytics:rtp-quality` Redis stream.
  Upserts rows in `call_quality` DB table on `call_id`.
  Exposes `GET /quality/:callId` REST endpoint.

### Stasis Handlers
- `sipTrafficMonitor.ts` keeps a persistent AMI socket (`EventMask: on`).
- `handlers/rtcp-ami.handler.ts` handles `RTCPReceived` + `RTCPSent` AMI events,
  extracts jitter/loss/RTT, computes MOS via `mosScore.ts`, and publishes to
  `callytics:rtp-quality` via Redis XADD + XTRIM.
- RTCP direction accumulation is cleaned on `StasisEnd` to avoid stale entries.

### Data Flow
Call ends
  → Asterisk fires RTCPReceived + RTCPSent via AMI
  → stasis RTCP AMI handler extracts metrics + computes MOS
  → publishes to callytics:rtp-quality (Redis XADD + XTRIM 1000)
  → backend QualityService consumes stream
  → upserts call_quality row in PostgreSQL
  → GET /quality/:callId available immediately
  → Call Logs frontend fetches quality on row render → shows MOS badge
  → clicking badge opens QualityDrawer with full metric breakdown
  → "View in Capture" links to /capture?callId=<id>

### Asterisk config
`rtp.conf` — added Phase 23.
All Asterisk configs live at `/etc/asterisk/` inside the container, written
by `make samples` at image build time. There is no bind-mount for configs.
`rtp.conf` was absent before Phase 23. Fixed by appending to the file in
the Dockerfile after make install. Pattern for future config changes:

```dockerfile
RUN cat >> /etc/asterisk/<file>.conf << 'EOF'
...content...
EOF
```

### WebSocket events — no change in Phase 23
Phase 23 is post-call only. No new WebSocket events.
`callytics:rtp-quality` Redis stream is consumed by `QualityService`
and persisted to DB. Frontend reads via REST only.

### Sidebar structure — no change in Phase 23

```text
MONITOR
  ├── diagnostics     (existing)
  ├── call logs       (existing — MOS column + quality drawer added here)
  ├── capture         (Phase 22B)
  └── recordings      (existing)
```

No new sidebar entry. Quality is accessible from within Call Logs only.

## Phase 31 conference architecture

Conference rooms use a fixed bridge ID derived from `roomName`. The Stasis app creates the ConfBridge mixing bridge on first channel arrival, reuses that bridge for later channels with the same room name, and destroys it only after the last channel leaves and the 30-second sole-survivor grace period expires. Waiting participants hear MOH until a moderator arrives.

## Phase 33 resource diagnostics architecture

### REST endpoint
- Backend exposes `GET /diagnostics/resources`
- Response shape includes `cpu`, `memory`, `disk`, `asterisk`, and `network`
- Each metric returns either data or an inline error payload so one failed probe does not blank the whole panel

### Resource collection path
- CPU usage is sampled from `/proc/stat` over a short interval and returned as a percentage
- Memory totals come from Node `os.totalmem()` and `os.freemem()`
- Disk usage for `/` comes from `df -k /`
- Network I/O totals come from `/proc/net/dev` with loopback excluded

### AMI channel count pattern
- Active Asterisk channels are fetched through a short AMI socket session
- The backend logs in to AMI, runs `CoreShowChannels`, counts `CoreShowChannel` events, and closes on `CoreShowChannelsComplete`
- This keeps the resource panel independent from the ARI-backed system health summary

### Frontend placement
- The Resource Usage Panel lives inside the Diagnostics page Network tab
- No new sidebar route was added for this feature
- System health keeps service reachability and version status only; channel count moved to the resource panel

## Phase 34 WireGuard VPN architecture

### Docker profile
- WireGuard runs as an optional `wireguard` service under the Compose `vpn` profile.
- Existing always-on services keep their current startup behavior.
- The WireGuard container uses bridge networking, exposes only `51820/udp`, persists config in `./wireguard-config`, and uses `10.8.0.0/24` with server IP `10.8.0.1`.
- The subnet assumes no overlap with the host LAN or Docker bridge networks.

### Backend module
- `VpnModule` owns `/vpn/*` endpoints and the `vpn_peers` table.
- `GET /vpn/status` checks `wg0`, reports server public key, endpoint, peer count, and host-interface subnet conflicts.
- `GET /vpn/peers` merges database peers with `wg show wg0 dump` to classify peers as active, idle, or offline.
- `POST /vpn/peers` generates WireGuard keys through `wg`, assigns the next `10.8.0.x` address, adds the live peer, writes a peer `.conf`, and returns the private key only once.
- `GET /vpn/peers/:id/config` returns raw WireGuard config text.
- `GET /vpn/peers/:id/qr` returns a PNG QR code generated by the backend `qrcode` package.
- `DELETE /vpn/peers/:id` removes the live WireGuard peer and sets `revoked_at`.
- `GET /vpn/relay-guide` returns structured guide steps so the frontend does not hardcode relay instructions.

### VPN-only extensions
- `sip_extensions.vpn_only` records whether an extension must register through the VPN subnet.
- When enabled, `ExtensionsService` writes a managed PJSIP ACL file for that extension permitting `10.8.0.0/24` and denying everything else.
- The generated extension endpoint references the ACL and reloads PJSIP through the existing AMI `module reload res_pjsip.so` path.
- If WireGuard is not installed, enabling VPN-only fails before saving with a clear validation error.

## Phase 35 SIP firewall architecture

### Log watcher extension
- `AsteriskLogsService` remains the single reader for `/var/log/asterisk/messages`.
- Phase 35 adds a lightweight tail loop inside that service instead of creating a second watcher process.
- New log lines are passed to `FirewallService.parseSecurityLog()` to classify failed registrations, authentication failures, INVITE floods, and allowed registrations.
- Historical log viewing through `GET /asterisk/logs` stays unchanged.

### Backend module
- `FirewallModule` owns `/firewall/*` endpoints and the firewall WebSocket gateway.
- Migration `030_phase35_sip_firewall.sql` creates `blocked_ips`, `firewall_events`, `firewall_stats`, and the singleton `firewall_config` row.
- `FirewallService` keeps an in-memory rolling attempt window per IP, backed by persisted events and blocked-address rows.
- Whitelisted IPs are recorded in `blocked_ips.is_whitelisted` and bypass threshold enforcement.

### Enforcement
- `iptables` mode is the default and runs `iptables -I INPUT -s <ip> -j DROP` from the backend container.
- The backend service has `NET_ADMIN` capability in Docker Compose so `iptables` can modify rules.
- `fail2ban` mode is opt-in and calls `fail2ban-client set asterisk banip <ip>`.
- The UI warns inline if `fail2ban-client --version` fails; it does not block the firewall page.

### GeoIP
- The backend uses `@maxmind/geoip2-node` when a local GeoLite2 country database exists.
- The database directory is mounted as the named Docker volume `callytics_geoip_data`.
- On first run, a MaxMind download is attempted only when `MAXMIND_LICENSE_KEY` is provided.
- Missing package/database/network never blocks enforcement; country fields fall back to `unknown` / `Unknown`.

### Realtime events
- `FirewallGateway` uses the existing Socket.IO server pattern.
- Clients join with `firewall:subscribe` and leave with `firewall:unsubscribe`.
- Events emitted:
  - `firewall:blocked` for newly blocked IP detail
  - `firewall:allowed` for successful known-good registration events
  - `firewall:feed` for every security event shown in the terminal feed
  - `firewall:stats` every 30 seconds for counters, heatmap, top sources, and trunk gauges
- Redis publishes the same feed payloads on `callytics:firewall-events` for other consumers.
