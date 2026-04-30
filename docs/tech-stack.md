# Tech stack

- `Asterisk 20`: Core PBX and call-control engine chosen for mature SIP/IVR capabilities and production-proven telephony behavior.
- `Node.js`: Unified JavaScript runtime across backend/runtime tooling to keep local setup and developer workflow consistent.
- `NestJS`: Structured backend framework used for modular APIs, services, scheduling, and WebSocket gateways.
- `React`: Frontend UI framework used for interactive operational pages and flow-editing experiences.
- `Vite`: Fast frontend build/dev toolchain chosen for quick iteration and efficient local developer feedback.
- `React Flow`: Graph editor library used to power node-based IVR flow design and edge management.
- `PostgreSQL`: Primary relational datastore for flows, telephony config state, logs, and operational metadata.
- `Redis`: Real-time transport/cache layer used for runtime event streams and low-latency telemetry fanout.
- `Socket.IO`: Browser realtime channel used for dashboard, diagnostics, capture, and firewall live updates.
- `Docker Compose`: Deployment/runtime orchestrator used for reproducible Linux self-hosted installation.
- `ffmpeg`: Media processing tool used to normalize uploaded/generated audio for telephony playback and browser preview.
- `Piper TTS`: Offline text-to-speech engine used to generate prompts without cloud TTS dependencies.
- `tshark`: Packet capture engine used to ingest SIP packets for live/historical troubleshooting workflows.
- `pcap-writer`: Node library used to generate downloadable `.pcap` files directly from captured packet data.
- `WireGuard`: VPN protocol/service used for secure remote softphone onboarding and controlled SIP access.
- `iptables`: Host firewall enforcement backend used for SIP abuse auto-blocking and runtime rule application.
- `VitePress`: Documentation site framework used to publish the public docs portal to GitHub Pages.
