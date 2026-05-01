# Architecture

## Core Architecture

`callytics` runs as a Docker Compose stack centered on Asterisk 20 for telephony, a NestJS backend for APIs and orchestration, a Node-based Stasis runtime for call execution, React + Vite for the UI, PostgreSQL for persistent state, and Redis for real-time event transport. Asterisk and Stasis run with host networking to keep ARI/AMI and RTP behavior stable, while application data and generated artifacts are persisted through database tables and named volumes.

## Call Execution Engine

Inbound calls are handed into the Stasis application, where flow graphs are loaded from PostgreSQL and executed node-by-node using database-backed nodes and edges. Runtime execution writes per-node trace entries to `call_node_logs`, allowing call timelines and post-call trace inspection in monitoring surfaces.

## Redis Streams

Redis streams provide bounded real-time transport for runtime telemetry and packet pipelines:

- `callytics:call-timeline` carries per-call execution timeline events.
- `callytics:sip-capture` carries parsed SIP packet events from the capture sidecar.
- `callytics:rtp-quality` carries post-call RTCP-derived quality metrics.

Streams are written with trimming to keep memory bounded while preserving enough recent events for replay and diagnostics.

## WebSocket Events

The backend relays runtime events to the browser through Socket.IO gateways so diagnostics, live dashboards, and security feeds update without polling loops. Capture clients receive `sip:packet` events in a dedicated room, firewall clients receive security feed and stats events, and timeline-capable views consume call execution event updates.

## SIP Capture

SIP capture is ingested by a tshark-based sidecar in the Asterisk runtime environment and normalized into Redis stream events. The backend exposes historical fetch and export APIs, including dialog-level and filtered bulk `.pcap` export generated in-memory through `pcap-writer`, and the UI renders live stream, packet details, and ladder-style troubleshooting views.

## RTP Quality Monitor

RTCP AMI events are consumed by the Stasis runtime, transformed into jitter/loss/RTT metrics, scored with a simplified E-model MOS function, and published to `callytics:rtp-quality`. The backend persists/upserts these metrics into `call_quality`, and call log views fetch quality data via REST to render MOS badges and quality detail drawers.

## WireGuard VPN

WireGuard is an optional Compose profile service used for secure remote SIP access with peer lifecycle managed by backend `/vpn/*` APIs. Peer creation generates keys and client config, status views merge live `wg` state with database rows, and extension policies can enforce VPN-only registration through generated PJSIP ACL rules.

### External Relay Mode

When the Callytics host is behind NAT or has no public IP, an external relay 
mode is available. A small public VPS runs WireGuard as the relay server. 
Callytics connects to it as a client peer via a Docker container 
(`callytics-relay`) using the `linuxserver/wireguard` image.

The relay container uses bridge networking with specific iptables rules:
- PREROUTING DNAT forwards inbound SIP (port 5080) and RTP (10000-20000) 
  from the WireGuard interface to the Docker bridge gateway
- POSTROUTING SNAT rewrites the source to the relay container WireGuard IP 
  (10.8.0.1) so Asterisk reply traffic routes back through the tunnel

On the host, a route (`10.8.0.0/24 via <bridge-gateway>`) and an iptables 
SNAT rule are applied automatically when relay activates, via short-lived 
privileged Docker containers. These are removed on deactivation.

When relay is active, Asterisk advertises the VPS public IP in SIP Contact 
headers and SDP via `external_signaling_address` and `external_media_address` 
written to `asterisk/base/pjsip_relay.conf` (gitignored, generated at runtime).

Relay mode and built-in VPN mode are mutually exclusive and cannot run 
simultaneously.

## SIP Firewall

Firewall monitoring extends the Asterisk log ingestion path to classify registration abuse and INVITE flood behavior, then applies threshold-based enforcement actions. Blocking state, event history, statistics, and config are persisted in PostgreSQL, with enforcement via `iptables` by default and optional `fail2ban` integration where available.

## Backup and Restore

Backup orchestration is owned by the backend `BackupModule`, which produces archives containing database dumps and optional recordings payloads, stores history/config metadata, and enforces retention policy. Restore workflows can replay database and recordings independently, then rebuild managed telephony config artifacts from restored rows before runtime restart signaling.

## Database

PostgreSQL is the system of record for call flows, version snapshots, node/edge graphs, extensions, trunks, inbound routes, queues, operators, campaigns, callbacks, recordings metadata, diagnostics data, VPN peers, firewall state, backup history/config, and preflight run history. Runtime-adjacent artifacts such as call traces (`call_node_logs`), SIP packets (`sip_messages`), and quality metrics (`call_quality`) are persisted for operational debugging and reporting continuity.
