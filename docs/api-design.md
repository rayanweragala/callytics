# API design

This API is REST-first and grouped by product modules used by the web UI.

## Flows

- `GET /flows` - List flows with pagination metadata for the builder and selection UIs.
- `GET /flows/:id` - Get one flow with its current graph snapshot.
- `POST /flows` - Create a flow and initial versioned graph.
- `PUT /flows/:id` - Save a flow update as a new current graph version.
- `DELETE /flows/:id` - Delete a flow and related graph/version records.
- `GET /flows/:id/versions` - List saved versions for one flow.
- `GET /flows/:id/versions/:versionId` - Get one saved flow version snapshot.
- `POST /flows/:id/versions` - Create an explicit saved version from current graph state.
- `POST /flows/:id/versions/:versionId/restore` - Restore a saved version into current flow state.
- `GET /flows/:id/breadcrumb` - Return breadcrumb metadata for flow hierarchy/navigation.
- `GET /flows/:id/tree` - Return tree data used by flow structure navigation.

## Audio

- `GET /audio` - List audio assets with pagination.
- `GET /audio/:id` - Get one audio asset.
- `GET /audio/voices` - List available TTS voices.
- `GET /audio/tts/voices` - List Piper TTS-compatible voices.
- `POST /audio/upload` - Upload and process an audio file.
- `POST /audio/tts` - Generate and store a TTS audio asset.
- `POST /audio/tts/preview` - Stream a non-persistent TTS preview.
- `DELETE /audio/:id` - Delete an audio asset.

## Recordings

- `GET /recordings` - List call recordings with pagination.
- `GET /recordings/:id` - Get one recording metadata row.
- `GET /recordings/:id/stream` - Stream recording media for browser playback.
- `GET /recordings/:id/download` - Download a recording file.
- `DELETE /recordings/:id` - Delete recording metadata and backing file when present.
- `POST /recordings/internal` - Internal runtime endpoint to persist completed recording metadata.

## Extensions

- `GET /extensions` - List SIP extensions.
- `POST /extensions` - Create a SIP extension and regenerate managed config.
- `PUT /extensions/:id` - Update a SIP extension and regenerate managed config.
- `DELETE /extensions/:id` - Delete a SIP extension and regenerate managed config.
- `GET /extensions/:id/qr-content` - Get provisioning payload used for extension QR setup.

## Inbound Routes

- `GET /inbound-routes` - List inbound DID route mappings.
- `POST /inbound-routes` - Create an inbound route.
- `PUT /inbound-routes/:id` - Update an inbound route.
- `DELETE /inbound-routes/:id` - Delete an inbound route.

## Trunks

- `GET /trunks` - List SIP trunks.
- `POST /trunks` - Create a SIP trunk and regenerate managed config.
- `PUT /trunks/:id` - Update a SIP trunk and regenerate managed config.
- `DELETE /trunks/:id` - Delete a SIP trunk and regenerate managed config.
- `POST /trunks/:id/test` - Run trunk reachability/qualify test.
- `POST /trunks/:id/test-outbound` - Start outbound trunk test call flow.
- `POST /trunks/:id/test-inbound` - Start inbound trunk test flow.
- `GET /trunks/:id/test-call/:testCallId/status` - Poll test call status.

## Operators

- `GET /operators` - List operators.
- `POST /operators` - Create an operator.
- `PUT /operators/:id` - Update an operator.
- `DELETE /operators/:id` - Delete an operator.

## Queues

- `GET /queues` - List queues.
- `POST /queues` - Create a queue.
- `PATCH /queues/:id` - Update queue configuration.
- `DELETE /queues/:id` - Delete a queue.

## Campaigns

- `GET /campaigns` - List campaigns with filters/pagination.
- `GET /campaigns/:id` - Get one campaign.
- `POST /campaigns` - Create a campaign.
- `PATCH /campaigns/:id` - Update campaign configuration/state.
- `DELETE /campaigns/:id` - Delete a campaign.
- `POST /campaigns/:id/contacts/upload` - Upload campaign contacts from CSV.
- `GET /campaigns/:id/contacts` - List campaign contacts.
- `GET /campaigns/:id/contacts/:contactId/attempts` - List attempt history for one contact.
- `POST /campaigns/:id/schedule` - Schedule a campaign run.
- `POST /campaigns/:id/stop` - Stop an active campaign.
- `GET /campaigns/:id/progress` - Get campaign execution progress.

## Diagnostics

- `GET /diagnostics/health` - Return service health summary.
- `GET /diagnostics/resources` - Return CPU/memory/disk/network/channel metrics.
- `POST /diagnostics/trunks/:id/test` - Run diagnostics test for a specific trunk.
- `POST /diagnostics/trunks/test-all` - Run diagnostics tests across trunks.
- `GET /diagnostics/registrations` - List SIP registration states.
- `GET /diagnostics/failures` - List recent call/trunk failure diagnostics.
- `GET /diagnostics/sip-messages` - List persisted SIP diagnostics rows.
- `GET /diagnostics/sip-messages/:callId` - List SIP diagnostics rows for one Call-ID.

## Capture

- `GET /capture/packets/:callId` - Get stored SIP packets for one call dialog.
- `GET /capture/export/dialog/:callId` - Export packets for one dialog as `.pcap`.
- `GET /capture/export/bulk` - Export filtered packet sets as `.pcap`.

## Quality

- `GET /quality/:callId` - Get persisted RTP quality metrics and MOS for one call.

## VPN

- `GET /vpn/status` - Get WireGuard service and peer status.
- `GET /vpn/peers` - List VPN peers with live status fields.
- `POST /vpn/peers` - Create a VPN peer.
- `GET /vpn/peers/:id/config` - Download peer WireGuard config.
- `GET /vpn/peers/:id/qr` - Get QR code for peer onboarding.
- `DELETE /vpn/peers/:id` - Revoke a peer.
- `DELETE /vpn` - Stop/disable active VPN service integration.
- `GET /vpn/relay-guide` - Get guided relay mode setup instructions.
- `POST /vpn/relay-config` - Save relay mode configuration.

## Firewall

- `GET /firewall/config` - Get SIP firewall configuration.
- `PUT /firewall/config` - Update SIP firewall configuration.
- `GET /firewall/preflight` - Run/read firewall readiness checks.
- `GET /firewall/blocked-ips` - List blocked IPs.
- `POST /firewall/blocked-ips` - Add a blocked IP.
- `DELETE /firewall/blocked-ips/:ip` - Remove a blocked IP.
- `POST /firewall/whitelist` - Add an IP to whitelist.
- `DELETE /firewall/whitelist/:ip` - Remove an IP from whitelist.
- `GET /firewall/events` - List firewall event feed history.
- `GET /firewall/stats` - Get firewall counters and summary stats.

## Backup

- `POST /backup` - Trigger backup creation.
- `GET /backup` - List backup history.
- `DELETE /backup/:id` - Delete a backup archive/history row.
- `GET /backup/:id/download` - Download a backup archive.
- `POST /backup/restore` - Restore from uploaded backup archive.
- `GET /backup/config` - Get backup schedule/retention config.
- `PUT /backup/config` - Update backup schedule/retention config.

## Preflight

- `POST /preflight/run` - Run a full preflight check set.
- `GET /preflight/history` - List recent preflight run history.

## Asterisk Logs

- `GET /asterisk/logs` - Read paginated/tail Asterisk log content for the viewer.

## Config

- `GET /config/host` - Return host/network information used by provisioning and UI flows.
