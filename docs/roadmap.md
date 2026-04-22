# Roadmap

## v1.0

Minimum useful product:

- Linux install through the npm-led setup flow
- Docker-based local runtime
- Single local admin user
- React web UI on `localhost`
- Visual IVR builder with core nodes:
  - start
  - play audio
  - menu
  - condition
  - transfer
  - queue
  - voicemail
  - hangup
- Audio upload and conversion
- Offline TTS prompt generation
- Draft and publish flow versions
- ARI Stasis app for call flow execution
- Optional SIP trunk setup
- Local softphone support when SIP trunk is skipped
- Live dashboard with active calls, queues, and recent events
- Basic reports:
  - call volume
  - answered calls
  - missed calls
  - voicemail activity
- Safe uninstall and reinstall behavior

If v1.0 does not install cleanly and run locally without telephony expertise, it misses the point.


## Current completed foundation phases

- Phase 1: workspace skeleton, Docker Compose, and base Asterisk config
- Phase 2: Asterisk 20 built from source, ARI and AMI verified, Stasis app connectivity working
- Phase 3: NestJS backend running in Docker with PostgreSQL health check and `/health` endpoint
- Phase 4: Stasis flow execution engine, schema migration, seed flow, flow loader, session manager, and node executors
- Phase 5: diagnostics UI completed: SIP status panel, Redis-to-Socket.io event relay, and live execution timeline
- Phase 6: React Flow builder UI completed with live backend persistence
- Phase 7: thin-slice backend REST API for flow CRUD implemented for the builder
- Phase 8: audio management completed with `audio_files`, ffmpeg conversion, offline Piper TTS, `/audio` page, builder audio picker integration, Stasis audio resolver, and shared pagination/search UI
- Phase 9: end-to-end live call verification completed with database-backed audio assets, Stasis flow execution, DTMF capture, and Asterisk playback fixed through `.ulaw` telephony assets
- Phase 10: conditional edge routing and transfer-node execution completed; `get_digits` now subscribes correctly to DTMF on the live ARI channel, ignores `h`-extension Stasis re-entry, and the Stasis seed path now skips any existing flow 1 with saved nodes instead of overwriting user-built routing
- Phase 11: call recording completed with a `call_recordings` table, NestJS `RecordingsModule`, bridge-based ARI recording, a `/recordings` frontend page with inline preview/download/delete actions, and diagnostics pagination for the live execution and SIP panels
- Phase 12: hunt group node, retry semantics, builder canvas minimap/layout improvements, and diagnostics live execution expanded-row layout fix completed
  - Hunt group node: sequential, random, group strategies
  - Hold audio loop during dialing, busy audio between retries
  - on_no_answer routing on exhaustion
  - Destination normalization (bare extension → PJSIP/ prefix)
  - Failed originate treated as retry attempt, not fatal error
  - get_digits implicit fallback: unmatched digit → invalid → default edge
  - Canvas mini-map with per-node-type accent colors
  - Canvas auto-layout via dagre (tidy layout button)
  - Diagnostics live execution expanded row layout fix
- Phase 16 Part A: flow builder node groups + multi-select completed
  - Added visual `group` nodes and group/ungroup toolbar actions
  - Shift+click multi-select now drives grouping actions
  - Persisted group membership via `flow_nodes.group_id`
  - Flow load/save maps backend `groupId` to React Flow `parentId`
- Phase 16 Part B: flow versioning completed
  - Added `flow_versions` metadata fields: `message`, `snapshot`, `node_count`
  - Added version endpoints: `GET /flows/:id/versions`, `GET /flows/:id/versions/:versionId`, `POST /flows/:id/versions`, `POST /flows/:id/versions/:versionId/restore`
  - Editor save path now creates committed versions visible in the versions drawer
  - Added compare and restore UX in the flow editor versions panel
  - Restore applies snapshot content and writes a new version message (`Restored from vN`)
- Phase 17: full test suite, coverage thresholds, GitHub Actions CI, and hunt-answer flow stabilization completed
  - Test suite totals: Stasis 58, Backend 85, Frontend 126
  - CI workflow added at `.github/workflows/ci.yml` for `dev` and `main` push/PR validation
  - Coverage gates now enforced across all three apps (`stasis`, `backend`, `frontend`)
  - Hunt executor behavior aligned with outbound Stasis-entry answer detection to reduce missed-bridge races
- Phase 21: SIP diagnostics ladder + persistent SIP message history completed
  - Stasis now includes Call-ID in SIP traffic telemetry when available
  - Backend persists SIP traffic rows into `sip_messages` and exposes diagnostics read endpoints
  - Diagnostics UI supports Call-ID drill-down from Panel D and Panel E into right-side SIP ladder panel
- Phase 22A: live call timeline relay and diagnostics gateway hardening completed ✓
  - Stasis `callytics:call-timeline` events are relayed through backend to frontend live execution panels
  - DiagnosticsGateway registration moved to `afterInit()` to avoid pre-server broadcast race
  - CallLogsListener startup now guarded when Redis config is absent/invalid
  - Post-22A test totals: Stasis 126, Backend 201, Frontend 212
- Phase 22B: SIP Capture page (current phase)
  - New `/capture` monitor page with split packet/dialog workflow
  - New backend CaptureService + CaptureController for tshark ingest and `.pcap` export
  - New Redis stream `callytics:sip-capture` and socket event `sip:packet` to `capture-room`
  - Existing Diagnostics SIP Traffic Inspector remains unchanged
- Phase 23: RTP monitor (planned)
- Phase 24: Asterisk log viewer (planned)
- Phase 25–34: remain in previously defined roadmap order after Phase 24

Important infrastructure change made during Phase 4:

- Old state: `stasis` on bridge networking while `asterisk` used host networking
- New state: both `asterisk` and `stasis` use `network_mode: host`
- Reason: the bridge-networked Stasis container could not reliably reach ARI once Asterisk moved to host networking

## v2.0

What gets added once people are using it:

- Multi-user accounts and basic roles
- Ring groups and better queue controls
- Business hours editor tied to flow conditions
- Flow templates for common setups
- CSV export for all main reports
- Better SIP provider presets
- Backup and restore from the UI
- Flow rollback history and publish notes
- More detailed flow analytics and node drop-off reporting
- Audio usage tracking and replace-in-place prompt updates
- Health diagnostics page for Docker, Asterisk, and trunk status

## v3.0

Fuller vision:

- Hosted cloud version
- Team collaboration with shared workspaces
- Audit logs and enterprise auth features
- White-label agency mode
- Managed SIP provider marketplace
- API keys and webhook integrations
- CRM and helpdesk integration points
- Smarter reporting with retention controls and scheduled exports
- High availability deployment path for paid users
- Advanced call apps if ARI becomes necessary

The v3.0 vision should only happen if the core local product is stable and trusted first.
