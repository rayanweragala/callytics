# callytics

Self-hosted open source call center platform. One command installs everything on Linux via Docker.

![callytics](frontend/public/callytics-logo.png)

## What it is

callytics is a self-hosted call center platform for developers and small businesses who need programmable IVR, call routing, SIP trunks, and a live operations dashboard without Twilio pricing or FreePBX complexity.

It is built around Asterisk ARI + Stasis, so call flows are database-driven and update instantly from the UI, with no manual dialplan editing required.

## Features

- Visual IVR flow builder with 13 node types
- SIP extensions, trunks, and inbound DID routing
- Outbound call campaigns with CSV upload and sliding window dialer
- Call queues and operator management
- Hunt groups with sequential, random, and group dial strategies
- Conference rooms via Asterisk ConfBridge
- Callback node for caller-requested callbacks
- Audio upload, ffmpeg conversion, and offline Piper TTS
- Call recordings with browser preview and download
- Live dashboard with active calls, queue status, and recent events
- Call logs with execution trace and RTP quality scoring
- SIP capture with live packet stream, ladder diagrams, and pcap export
- Network diagnostics with trunk testing, SIP registration status, and resource usage
- Asterisk log viewer with plain-English translation
- SIP firewall with auto-blocking, live feed, and GeoIP
- Backup and restore with scheduling and retention
- WireGuard VPN with peer management, QR onboarding, and VPN-only extension controls
- IVR templates with one-click import and JSON import
- Network preflight wizard

## Quick start

```bash
git clone https://github.com/rayanweragala/callytics.git
cd callytics
cp .env.example .env
bash scripts/install.sh
```

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
