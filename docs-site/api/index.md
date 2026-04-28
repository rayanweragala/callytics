# API Reference

Routes below are extracted from `backend/src/**/*controller.ts` decorators.

## Flows

`GET /flows`
Description: List flows with pagination/filtering.

`GET /flows/:id`
Description: Get one flow detail (nodes, edges, active version).

`POST /flows`
Description: Create a flow.

`PUT /flows/:id`
Description: Update/save a flow.

`DELETE /flows/:id`
Description: Delete a flow.

`GET /flows/:id/versions`
Description: List saved versions for a flow.

`GET /flows/:id/versions/:versionId`
Description: Get one flow version snapshot.

`POST /flows/:id/versions`
Description: Create/save a new version entry.

`POST /flows/:id/versions/:versionId/restore`
Description: Restore a previous version into current flow state.

`GET /flows/:id/breadcrumb`
Description: Get parent/child breadcrumb context for subflows.

`GET /flows/:id/tree`
Description: Get flow tree with subflow relationships.

## Extensions

`GET /extensions`
Description: List SIP extensions.

`POST /extensions`
Description: Create extension.

`PUT /extensions/:id`
Description: Update extension.

`DELETE /extensions/:id`
Description: Delete extension.

## Trunks

`GET /trunks`
Description: List SIP trunks.

`POST /trunks`
Description: Create trunk.

`PUT /trunks/:id`
Description: Update trunk.

`DELETE /trunks/:id`
Description: Delete trunk.

`POST /trunks/:id/test`
Description: Run trunk test.

`POST /trunks/:id/test-outbound`
Description: Start outbound trunk test call.

`POST /trunks/:id/test-inbound`
Description: Start inbound trunk test call.

`GET /trunks/:id/test-call/:testCallId/status`
Description: Read trunk test call status.

## Inbound

`GET /inbound-routes`
Description: List inbound DID routes.

`POST /inbound-routes`
Description: Create inbound route.

`PUT /inbound-routes/:id`
Description: Update inbound route.

`DELETE /inbound-routes/:id`
Description: Delete inbound route.

## Queues

`GET /queues`
Description: List queues.

`POST /queues`
Description: Create queue.

`PATCH /queues/:id`
Description: Update queue.

`DELETE /queues/:id`
Description: Delete queue.

## Operators

`GET /operators`
Description: List operators with computed status.

`POST /operators`
Description: Create operator.

`PUT /operators/:id`
Description: Update operator.

`DELETE /operators/:id`
Description: Delete operator.

## Campaigns

`GET /campaigns`
Description: List campaigns.

`GET /campaigns/:id`
Description: Get campaign detail.

`POST /campaigns`
Description: Create campaign.

`PATCH /campaigns/:id`
Description: Update campaign.

`DELETE /campaigns/:id`
Description: Delete campaign.

`POST /campaigns/:id/contacts/upload`
Description: Upload/import campaign contacts CSV.

`GET /campaigns/:id/contacts`
Description: List campaign contacts.

`GET /campaigns/:id/contacts/:contactId/attempts`
Description: List attempt history for one campaign contact.

`POST /campaigns/:id/schedule`
Description: Move campaign to scheduled state.

`POST /campaigns/:id/stop`
Description: Stop/cancel running or scheduled campaign.

`GET /campaigns/:id/progress`
Description: Read campaign progress counters.

## Recordings

`GET /recordings`
Description: List call recordings.

`POST /recordings/internal`
Description: Internal recording persistence endpoint (token-protected header).

`GET /recordings/:id`
Description: Get recording metadata.

`GET /recordings/:id/stream`
Description: Stream recording content.

`GET /recordings/:id/download`
Description: Download recording file.

`DELETE /recordings/:id`
Description: Delete recording.

## Capture

`GET /capture/packets/:callId`
Description: Get SIP capture packets for call id.

`GET /capture/export/dialog/:callId`
Description: Export one call SIP dialog.

`GET /capture/export/bulk`
Description: Bulk export SIP capture data.

## Diagnostics

`GET /diagnostics/health`
Description: Get diagnostics health summary.

`GET /diagnostics/resources`
Description: Get runtime resource metrics.

`POST /diagnostics/trunks/:id/test`
Description: Trigger diagnostics trunk test.

`POST /diagnostics/trunks/test-all`
Description: Trigger diagnostics for all trunks.

`GET /diagnostics/registrations`
Description: Get current SIP registration snapshot.

`GET /diagnostics/failures`
Description: Get recent call/registration failures.

`GET /diagnostics/sip-messages`
Description: List SIP signaling messages.

`GET /diagnostics/sip-messages/:callId`
Description: List SIP signaling messages for one call.

## Firewall

`GET /firewall/config`
Description: Get firewall config.

`PUT /firewall/config`
Description: Update firewall config.

`GET /firewall/preflight`
Description: Get firewall preflight status (including fail2ban availability).

`GET /firewall/blocked-ips`
Description: List currently blocked IPs.

`POST /firewall/blocked-ips`
Description: Manually block an IP.

`DELETE /firewall/blocked-ips/:ip`
Description: Unblock an IP.

`POST /firewall/whitelist`
Description: Add whitelist IP.

`DELETE /firewall/whitelist/:ip`
Description: Remove whitelist IP.

`GET /firewall/events`
Description: List firewall event history.

`GET /firewall/stats`
Description: Get firewall stats payload.

## VPN

`GET /vpn/status`
Description: Read VPN install/runtime status.

`GET /vpn/peers`
Description: List active VPN peers.

`POST /vpn/peers`
Description: Create VPN peer.

`GET /vpn/peers/:id/config`
Description: Get peer config text.

`GET /vpn/peers/:id/qr`
Description: Get peer config QR PNG.

`DELETE /vpn/peers/:id`
Description: Revoke one VPN peer.

`DELETE /vpn`
Description: Remove WireGuard container/runtime.

`GET /vpn/relay-guide`
Description: Get step-by-step relay setup guide payload.

`POST /vpn/relay-config`
Description: Generate relay config from VPS key/IP.

## Backup

`POST /backup`
Description: Create backup archive.

`GET /backup`
Description: List backup history.

`DELETE /backup/:id`
Description: Delete backup entry and file.

`GET /backup/:id/download`
Description: Download backup archive.

`POST /backup/restore`
Description: Restore backup archive (DB and/or recordings).

`GET /backup/config`
Description: Get backup scheduler config.

`PUT /backup/config`
Description: Update backup scheduler config.

## Config

`GET /config/host`
Description: Get host SIP provisioning values (`hostIp`, `sipPort`).

## Audio

`GET /audio`
Description: List audio files.

`GET /audio/voices`
Description: List TTS voices.

`GET /audio/:id`
Description: Get one audio file record.

`POST /audio/upload`
Description: Upload audio file.

`POST /audio/tts`
Description: Generate and save TTS audio.

`POST /audio/tts/preview`
Description: Generate TTS preview.

`DELETE /audio/:id`
Description: Delete audio file.

## Additional controllers present in source

### Call logs

`GET /call-logs`
Description: List call logs.

`GET /call-logs/:callUuid/trace`
Description: Get node-level trace for a call UUID.

### Callbacks

`GET /callbacks`
Description: List callback jobs.

`GET /callbacks/:id`
Description: Get callback job.

`POST /callbacks/:id/execute`
Description: Execute callback immediately.

`POST /callbacks/:id/cancel`
Description: Cancel callback job.

### Contact numbers

`GET /contact-numbers`
Description: List contact numbers.

`GET /contact-numbers/:id`
Description: Get contact number.

`POST /contact-numbers`
Description: Create contact number.

`PATCH /contact-numbers/:id`
Description: Update contact number.

`DELETE /contact-numbers/:id`
Description: Delete contact number.

### Templates

`GET /templates`
Description: List flow templates.

`POST /templates/:id/import`
Description: Import template into flows.

### Preflight

`POST /preflight/run`
Description: Run preflight checks.

`GET /preflight/history`
Description: Get preflight history.

### Quality

`GET /quality/:callId`
Description: Get call quality metrics for call id.

### Asterisk logs

`GET /asterisk/logs`
Description: Read paged Asterisk log lines.

### Health

`GET /health`
Description: Basic health endpoint.
