# Planned folder structure

```text
callytics/
├── docs/                         # planning and product docs
│   ├── overview.md
│   ├── how-it-works.md
│   ├── tech-stack.md
│   ├── features.md
│   ├── folder-structure.md
│   ├── install-flow.md
│   ├── ivr-flow-engine.md
│   ├── audio-handling.md
│   ├── database-schema.md
│   ├── api-design.md
│   ├── live-dashboard.md
│   ├── monetization.md
│   ├── risks.md
│   ├── roadmap.md
│   └── sip-capture.md
├── package.json                  # npm workspace root, CLI commands, and install metadata
├── docker-compose.yml            # local development and self-hosted service orchestration, including host networking for asterisk and stasis
├── .env.example                  # environment variable template for local and containerized runs
├── README.md                     # top-level project intro and quick start
├── frontend/                     # React + Vite web app for flows, dashboard, settings, and reports
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/                      # pages, components, API clients, and flow editor code
├── backend/                      # NestJS API, realtime gateways, integrations, jobs, static media serving, and offline TTS
│   ├── package.json
│   ├── tsconfig.json
│   ├── voices/                   # bundled Piper voice model files included in the backend image
│   └── src/
│       ├── app.module.ts
│       ├── health/               # health and service readiness controllers
│       ├── modules/              # domain modules such as flows, audio, calls, reports, settings
│       ├── audio/                # audio API, conversion pipeline, voice catalog, and media-serving helpers
│       ├── asterisk/             # AMI and ARI clients plus Asterisk integration helpers
│       ├── realtime/             # Socket.io gateways and event fanout
│       ├── workers/              # background jobs for audio conversion and report tasks
│       └── db/                   # ORM schema, repositories, and migrations
├── stasis/                       # separate Node.js workspace package for ARI/Stasis call execution
│   ├── package.json
│   ├── tsconfig.json
│   └── src/                      # ARI connection bootstrap, Stasis event handlers, and call runtime
├── asterisk/                     # managed Asterisk config layer owned by callytics
│   ├── base/                     # stable base config files shipped with the product
│   ├── trunks/                   # generated SIP trunk and provider config fragments managed from settings
│   ├── sounds/                   # mounted path for converted audio assets
│   └── voicemail/                # voicemail config and storage mounts
├── storage/                      # persistent app data outside source code
│   ├── audio/                    # source uploads, converted telephony WAVs, preview WAVs, generated TTS, and copied voice assets
│   │   ├── originals/
│   │   ├── converted/
│   │   ├── previews/
│   │   ├── tts/
│   │   ├── voices/
│   ├── voicemail/                # voicemail recordings
│   ├── reports/                  # generated report exports
│   └── backups/                  # user-triggered backup artifacts
├── scripts/                      # install, bootstrap, healthcheck, backup, and uninstall scripts
├── docker/                       # Dockerfiles, compose helpers, and container runtime config
│   ├── api/                      # backend container definition
│   ├── web/                      # frontend container definition and nginx config
│   ├── stasis/                   # Stasis worker container definition
│   └── asterisk/                 # Asterisk container definition and package layer
└── .github/                      # CI workflows, issue templates, and release automation
```

Notes:

- `stasis/` is a real standalone Node.js package in the npm workspace. It is not embedded inside the NestJS backend process.
- `stasis/src/` now includes the flow runtime engine, database migration/seed entrypoints, flow loader, call session manager, and node executors.
- `frontend/src/` now contains routed pages for diagnostics, audio, and the flow builder, plus canonical Control Room components and builder-specific canvas components.
- Phase 22B adds `/capture` route and capture-focused UI under `frontend/src/pages/CapturePage.tsx` with reusable packet/dialog components in shared/common component folders where possible.
- `frontend/src/components/common/` contains shared `SearchableSelect` and `Pagination` components used across multiple pages.
- `backend/src/` now includes diagnostics and capture infrastructure:
  - `backend/src/diagnostics/` for socket relay and diagnostics stream fanout
  - `backend/src/capture/` for `CaptureService`, `CaptureController`, and SIP capture DTOs/export logic
- `asterisk/base` should stay mostly hand-maintained and small.
- `asterisk/trunks` should be fully machine-generated from saved SIP trunk settings.
- `storage` should be mount-backed so reinstalls do not destroy user data.

- The backend container mounts the repo `./storage` directory at `/app/storage` for audio and other persistent assets.
- Asterisk mounts `./storage/audio/converted` at `/var/lib/asterisk/sounds/callytics` for telephony playback.
