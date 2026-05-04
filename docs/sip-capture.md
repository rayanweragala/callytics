# SIP Capture (Phase 22B)

## Overview

Phase 22B adds a dedicated SIP Capture page at `/capture` under MONITOR in the sidebar.

Purpose:
- Let self-hosting users diagnose SIP call failures from the UI without Linux terminal access
- Provide a packet-level and dialog-level troubleshooting workflow for both non-technical and technical users
- Export packet captures (`.pcap`) directly from the app for escalation and deep analysis

Important scope boundary:
- Existing SIP Traffic Inspector on Diagnostics (Panel D) remains unchanged
- SIP Capture is additive and uses separate backend stream/event plumbing

Audience:
- Non-technical operators who need clear verdicts and guided diagnostics
- Technical operators who need packet details, headers, SDP, and exportable captures

## Page layout

Two-panel persistent split view:
- Left panel (40%): packet stream with filters + paginated table
- Right panel (60%): dialog detail for currently selected Call-ID

Top page header includes:
- Title: `SIP Capture`
- Live indicator (connected/reconnecting)
- Controls: `Pause`, `Clear`, `Export .pcap`
- Status line: source interface, packet count, ring buffer usage
  - Example: `source: tshark -i any | packets: 247 | buffer: 64%`

## Left panel: Packet Stream

### Filter bar
- Method dropdown:
  - All
  - INVITE
  - BYE
  - ACK
  - REGISTER
  - OPTIONS
  - Errors only
- Call-ID text input
- Trunk/Extension dropdown
- Time range inputs (`from`, `to`)

### Packet table columns
- TIME
- METHOD
- FROM
- TO
- CODE
- CALL-ID (truncated for readability)

### Visual behavior
- Timestamp text uses amber style (same as existing inspector)
- Method chip colors match existing inspector (INVITE blue, BYE orange)
- Selected row uses left-border highlight
- Error rows (`4xx`/`5xx`) use subtle red tint
- Live packets animate in from the top with pulse (reuse Phase 22A timeline pulse pattern)

### Pagination
- Newer / Older arrow controls
- Current page and total pages
- No modal drill-down from this list; selection updates right panel in place

## Right panel: Dialog Detail

Three stacked sections:

### 1) Verdict Banner

A pure rule engine computes a verdict from packet sequence only:
- No API calls
- No external services
- Works fully offline

Verdict colors:
- Green: completed normally
- Amber: degraded/unexpected end
- Red: failure path

Rule table:

| SIP sequence | Verdict | Colour |
|---|---|---|
| INVITE → 200 → BYE | Call completed normally | green |
| INVITE → 200, no BYE | Call may have dropped — no BYE received | amber |
| INVITE → 486 | Called party was busy | amber |
| INVITE → 404 | Number not found — check dialplan | red |
| INVITE → 408 | Request timeout — trunk may be unreachable | red |
| INVITE → 403 | Forbidden — check trunk credentials | red |
| INVITE → 503 | Service unavailable — trunk down | red |
| INVITE, no response | No response — possible NAT/firewall issue | red |
| REGISTER → 200 | Extension registered successfully | green |
| REGISTER → 401/407 | Registration failed — wrong password | red |
| REGISTER → 403 | Registration forbidden — check trunk auth | red |

### 2) SIP Ladder
- Reuse existing SIP ladder component from prior phases
- Render inline in the right panel (no modal wrapper)
- No ladder component redesign in this phase

### 3) SIP Headers Accordion
- One accordion item per packet in selected dialog
- Default collapsed row header: `METHOD + timestamp`
- Expanded content:
  - Parsed SIP headers as key/value rows
  - Nested collapsible SDP body section
  - `[raw]` action to view full tshark JSON for that packet
- Right panel header includes `Export this dialog .pcap`
  - Calls `GET /capture/export/dialog/:callId`

## Backend architecture

## Asterisk capture sidecar (new runtime component)

Responsibilities:
- Spawn and supervise:
  - `tshark -i any -f "udp port ${TSHARK_PORT}" -T ek -l`
  - `TSHARK_PORT` defaults to `5060`
  - current compose value is `5080` to match `pjsip.conf`
- Parse tshark Elastic JSON into `SipPacket` fields
- Write packets into Redis stream `callytics:sip-capture` via `XADD`
- Apply ring-buffer trim (`XTRIM`) max length `500`
- Graceful shutdown on SIGTERM/SIGINT
- Auto-restart capture loop if tshark exits unexpectedly (retry after 5 seconds)
- CI guard
  - Never spawn tshark unless `TSHARK_ENABLED === "true"` on the Asterisk service

### SipPacket DTO

```ts
{
  id: string           // Redis stream entry ID
  timestamp: string    // e.g. "10:42:57.000"
  method: string       // INVITE, BYE, ACK, OPTIONS, REGISTER, 200, 486...
  from: string         // SIP From header value
  to: string           // SIP To header value
  callId: string       // SIP Call-ID header
  direction: 'in' | 'out'
  statusCode?: number  // for responses
  rawJson: string      // full tshark JSON blob for .pcap reconstruction
}
```

## Backend capture consumer path

- Keep existing `sip:traffic` behavior unchanged
- CaptureService reads Redis stream data for export/filter APIs
- DiagnosticsGateway performs Redis replay + live fanout:
  - Subscribe/read from `callytics:sip-capture`
  - Emit `sip:packet` events to `capture-room`
  - On room join, replay last 500 stream entries via `XRANGE`/`XREVRANGE`

## CaptureController (new REST controller)

Endpoints:
- `GET /capture/export/dialog/:callId`
  - Exports one dialog as `.pcap`
- `GET /capture/export/bulk`
  - Exports currently filtered packet view as `.pcap`

Implementation notes:
- Use `pcap-writer` to construct valid packet-capture output
- No disk writes; stream binary response directly

## Asterisk container/runtime changes

- Install `tshark` in Asterisk image during build (`apt-get install -y tshark`)
- Add capture sidecar script to the Asterisk image and launch it alongside Asterisk via entrypoint wrapper
- Use `redis-cli` in the sidecar to publish SIP packets to Redis (`REDIS_HOST`/`REDIS_PORT`)
- If required by environment permissions, add capture capability group:
  - `usermod -aG wireshark asterisk`
- Runtime flags:
  - local dev: `TSHARK_ENABLED=true` on `asterisk` service
  - CI: `TSHARK_ENABLED=false` (or unset) on `asterisk` service
  - `TSHARK_PORT` on `asterisk` controls the UDP capture filter port
    - default: `5060`
    - current compose value: `5080` (aligned with `pjsip.conf`)
  - backend service does not use `TSHARK_ENABLED` or `TSHARK_PORT`

## Sidebar and routing

- Add MONITOR child entry: `Capture`
- Route path: `/capture`
- Update locked sidebar/guider context docs when phase work starts

## Testing targets

Backend target additions (+8):
- CaptureService Redis read/write behavior
- parseSipPacket mapping
- Redis XADD/XTRIM write behavior
- sidecar graceful shutdown + restart behavior
- CI guard behavior when `TSHARK_ENABLED` not `true` on asterisk
- export dialog endpoint
- export bulk endpoint
- replay behavior on reconnect

Frontend target additions (+15):
- filter bar interactions
- row selection and right-panel binding
- verdict rule engine (at least one test per rule)
- accordion expand/collapse
- raw JSON toggle
- export buttons
- empty state
- pagination behavior

CI guard acceptance condition:
- With `TSHARK_ENABLED` unset/false, asterisk starts without capture sidecar and backend boot must not crash
