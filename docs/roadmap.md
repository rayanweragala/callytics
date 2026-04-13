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
