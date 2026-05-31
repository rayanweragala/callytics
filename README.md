# callytics

Self-hosted open-source voice automation platform. One command installs everything on Linux via Docker.

## Demo

<video src="docs/demo.mp4" controls width="100%"></video>

## What it is

Callytics is a self-hosted voice automation platform for developers and small businesses who need programmable IVR, call routing, SIP trunks, and a live operations dashboard — without Twilio pricing or FreePBX complexity.

It is built around Asterisk ARI + Stasis, so call flows are database-driven and update instantly from the UI with no manual dialplan editing required.

## Features

- Programmable IVR with a visual flow builder, 13 node types, templates, and instant database-driven updates
- Live operations dashboard with real-time active calls, system health, SIP registration status, queue depth, and campaign progress
- SIP operations for extensions, trunks, inbound DID routing, hunt groups, queues, callbacks, conferences, and outbound campaigns
- Audio tooling for uploads, `ffmpeg` conversion, offline Piper TTS, call recordings, browser preview, and download
- SIP and network diagnostics including live packet capture, ladder diagrams, pcap export, trunk testing, registration status, and resource usage
- Security and platform operations with SIP auto-blocking, GeoIP, WireGuard peer management, VPN-only extension controls, backups, restore, and network preflight checks
- Browser softphone built in — no external SIP client needed for testing
- Command palette (`Ctrl+K`) for instant navigation across flows, extensions, trunks, and pages

## Quick start

```bash
git clone https://github.com/rayanweragala/callytics.git
cd callytics
cp .env.example .env
bash scripts/install.sh
```

## Required configuration before first start

Before running `bash scripts/install.sh`, copy `.env.example` to `.env` and set these values:

- `HOST_IP` — set to your machine's LAN IP address, not `127.0.0.1`. Run `ip route get 1 | awk '{print $7; exit}'` to find it. Leaving it as `127.0.0.1` means softphones on other devices will fail to register and SIP QR codes will be wrong.
- `RECORDINGS_INTERNAL_TOKEN` — change from the default value. Used to authenticate internal recording requests between Stasis and backend.
- `SIP_PORT` — default `5080`. Only change if that port is already in use on your host.

Then open `http://localhost:3000`

## Requirements

- Linux only (Ubuntu 22.04+ recommended)
- Docker and Docker Compose
- Ports: 3000 (UI), 3001 (API), 5080 (SIP), 8088 (ARI), 51820/udp (WireGuard optional)

## Supported environments

- Ubuntu 22.04 and 24.04 tested and supported
- Linux only
- Docker 24+ required

## Tech stack

- Asterisk 20
- Node.js
- NestJS
- React + Vite
- PostgreSQL
- Redis
- Docker Compose

## License

MIT

## Credits

- Asterisk — GPLv2 telephony engine used in the runtime stack.
- NGINX — BSD 2-Clause web server used in the frontend runtime image.
- [Sniffnet](https://github.com/GyulyVGC/sniffnet) — design inspiration for the UI theme and color system.

## Troubleshooting

- Port already in use: check which process owns the port with `ss -tulpn | grep <port>`, stop it, then rerun `docker compose up -d`.
- SIP not registering: verify `SIP_PORT` is `5080` and not blocked by firewall, confirm extension credentials match what is provisioned in the app.
- Audio not playing: check that the audio file was uploaded and converted successfully in the Audio page, verify Asterisk container is healthy.
- One-way audio: disable SIP ALG on your router, check NAT detection result in the preflight wizard.
- Docker socket permission denied: ensure the user running Docker is in the docker group (`sudo usermod -aG docker $USER`).

## Contributing

Contributions are welcome. Open an issue to report a bug, suggest an improvement, or discuss an idea before larger changes. If you have a fix ready, open a pull request. Feedback, bug reports, and documentation improvements are just as valuable as code contributions.