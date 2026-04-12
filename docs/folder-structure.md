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
│   └── roadmap.md
├── package.json                  # npm package entry, CLI commands, and install metadata
├── README.md                     # top-level project intro and quick start
├── frontend/                     # React web app for flows, audio, dashboard, and settings
│   ├── public/                   # static assets served to the browser
│   └── src/                      # pages, components, API clients, and flow editor code
├── backend/                      # NestJS API, services, jobs, and Asterisk integration
│   ├── src/
│   │   ├── modules/              # domain modules such as flows, audio, calls, reports, settings
│   │   ├── asterisk/             # AMI and ARI clients, Stasis runtime, and SIP config management
│   │   ├── realtime/             # Socket.io gateways and event fanout
│   │   ├── workers/              # background jobs for audio conversion and report tasks
│   │   └── db/                   # ORM schema, repositories, and migrations
│   └── test/                     # backend tests
├── asterisk/                     # managed Asterisk config layer owned by callytics
│   ├── base/                     # stable base config files shipped with the product
│   ├── trunks/                   # generated SIP trunk and provider config fragments managed from settings
│   ├── sounds/                   # mounted path for converted audio assets
│   └── voicemail/                # voicemail config and storage mounts
├── storage/                      # persistent app data outside source code
│   ├── audio/                    # source uploads and converted prompt files
│   ├── voicemail/                # voicemail recordings
│   ├── reports/                  # generated report exports
│   └── backups/                  # user-triggered backup artifacts
├── scripts/                      # install, bootstrap, healthcheck, backup, and uninstall scripts
├── docker/                       # Dockerfiles, compose files, and image build helpers
│   ├── api/                      # backend container definition
│   ├── web/                      # frontend container definition
│   └── asterisk/                 # Asterisk container definition and package layer
└── .github/                      # CI workflows, issue templates, and release automation
```

Notes:

- `asterisk/base` should stay mostly hand-maintained and small.
- `asterisk/trunks` should be fully machine-generated from saved SIP trunk settings.
- `storage` should be mount-backed so reinstalls do not destroy user data.
