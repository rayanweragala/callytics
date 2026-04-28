# Architecture

## How the stack is assembled

From `docker-compose.yml`, the runtime is split across these services:

| Service | Role | Network mode | Ports | Volumes | Depends on |
| --- | --- | --- | --- | --- | --- |
| `postgres` | Primary relational store for configuration and runtime data. | default bridge | `127.0.0.1:5432:5432` | `callytics_postgres_data:/var/lib/postgresql/data` | none |
| `redis` | Event bus/state cache for telemetry, queue state, campaign and callback signaling. | default bridge | `127.0.0.1:6380:6379` | `callytics_redis_data:/data` | none |
| `asterisk` | SIP/RTP/media engine and ARI endpoint. | `host` | host stack (no `ports:` block) | `./asterisk/base`, `./asterisk/logs`, audio/voicemail mounts, `asterisk_recordings` | `postgres`, `redis` (health-checked indirectly by service readiness) |
| `backend` | NestJS API, DB owner for most write paths, config generation, diagnostics, firewall/VPN/backup APIs. | `host` | host stack (serves on `BACKEND_PORT`, default `3001`) | Asterisk config/log mounts, audio storage mounts, `callytics_geoip_data`, `callytics_backup_data`, `asterisk_recordings`, `/var/run/docker.sock:ro` | `postgres`(healthy), `redis`(healthy) |
| `frontend` | React UI served on port 3000. | default bridge | `127.0.0.1:3000:3000` | repo bind mount + `/app/node_modules` | `backend` |
| `stasis` | Node runtime that executes call flows via ARI and runs campaign dialer/event producers. | `host` | host stack | `.env` via `env_file`, no extra bind mounts | `asterisk`(healthy), `postgres`(healthy), `redis`(healthy) |
| `wireguard` (profile `vpn`) | Optional VPN endpoint for remote SIP clients. | `bridge` | `51820:51820/udp` | `./wireguard-config:/config` | none |

The named volumes declared are `callytics_postgres_data`, `callytics_redis_data`, `asterisk_recordings`, `callytics_geoip_data`, and `callytics_backup_data`.

## Why `network_mode: host` for Asterisk and Stasis

`asterisk` is on host networking so SIP signaling and RTP media bind on the host IP/ports directly. In this deployment, that avoids Docker bridge/NAT address translation for telephony signaling/media and keeps ARI/AMI at host-loopback addresses.

`stasis` is also on host networking and connects to ARI at `http://127.0.0.1:8088` (`stasis/src/index.ts`). With host mode, that loopback target resolves to the same host network namespace where Asterisk exposes ARI.

`wireguard` is intentionally different (`network_mode: bridge` with explicit UDP `51820` publish). Its job is tunnel termination and peer routing, not direct SIP/RTP socket ownership.

## Redis as the communication backbone

Actual channels/streams used in source:

- Stasis telemetry publish (`stasis/src/telemetry.ts`):
  - `callytics:call-timeline`
  - `callytics:call-events`
  - `callytics:sip-status`
  - `callytics:sip-traffic`
- Trunk test signaling (`stasis/src/index.ts`, `backend/src/trunks/trunks.service.ts`):
  - `trunk:test:outbound`
  - `trunk:test:inbound`
  - key `trunk:test:<testCallId>:status`
- Campaign control/events (`stasis/src/campaign-executor.ts`, `backend/src/campaigns/campaigns.service.ts`):
  - `campaign:start:*`, `campaign:stop:*`
  - `campaign:contact:update`, `campaign:stats:update`, `campaign:completed`, `campaign:cancelled`
  - key `campaign:active:<campaignId>`
- Callback signaling (`stasis/src/callback-execute.ts`, `stasis/src/nodes/callback.executor.ts`, `backend/src/callbacks/callbacks.service.ts`):
  - `callback:execute`, `callback:created`, `callback:status:update`
- Firewall publish (`backend/src/firewall/firewall.service.ts`):
  - `callytics:firewall-events`
- Redis streams:
  - `callytics:sip-capture` (capture)
  - `callytics:rtp-quality` (RTCP quality feed)

NestJS subscribers consume these channels for persistence and realtime relay (for example `call-logs.listener`, `campaigns.service`, `diagnostics.service`, `callbacks.service`).

Important boundary from code audit: there is **not** a strict “Stasis never writes PostgreSQL” boundary in current code. Stasis writes tables such as `call_node_logs` (`stasis/src/runtime.ts`) and voicemail `call_recordings` (`stasis/src/executors/voicemail.executor.ts`) directly, while NestJS also owns many DB writes from Redis events (campaign state, call logs, diagnostics-facing data, etc.).

## The call execution path, step by step

1. A SIP INVITE lands in Asterisk and is routed to `Stasis(callytics)` by generated dialplan (`extensions_callytics_inbound.conf`, built by backend).
2. Stasis receives `StasisStart` (`stasis/src/index.ts`) and chooses a flow using `loadFlow()`/`loadFlowById()` (`stasis/src/flowLoader.ts`), which only loads `call_flows.status = 'published'` and uses `current_version_id`.
3. Stasis creates a call session and runs `runFlow()` (`stasis/src/runtime.ts`).
4. `runFlow()` executes node handlers via `executeNode()` (`stasis/src/nodes/index.ts`), sends ARI commands (playback, originate, bridge, record, hangup), resolves branching through `resolveNextEdge()` (`stasis/src/engine/edgeResolver.ts`), and supports submenu/subflow stack transitions.
5. During execution, telemetry is published to Redis channels (`callytics:call-timeline`, `callytics:call-events`, `callytics:sip-traffic` etc.).
6. Backend subscribers consume those events and persist/query for API and dashboards (`backend/src/call-logs`, `backend/src/campaigns`, `backend/src/diagnostics`, `backend/src/callbacks`, `backend/src/quality`).
7. On terminal state, Stasis emits final `failed`/`ended` call events; backend services and frontend sockets show the finalized timeline and status.
