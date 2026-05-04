# callytics overview

`callytics` is a self-hosted open source call center platform for Linux teams that want programmable telephony without managed per-minute platform pricing. It is built for developers and small businesses that need IVR, SIP extensions, trunk connectivity, outbound campaigns, and real-time operational visibility in one deployable stack.

The key differentiator is the ARI + Stasis execution model: call flows are stored in the database and executed by a Node runtime, so updates are applied from the UI instantly without hand-editing dialplans. This keeps Asterisk as the proven telephony engine while replacing manual PBX operations with application-level workflow control.

## What is built

- Visual IVR flow builder with 13 node types gives operators a drag-and-drop canvas to build and publish call logic without editing telephony config files.
- SIP extensions, trunks, and inbound DID routing provide full endpoint provisioning, provider connectivity, and number-to-flow mapping from the web UI.
- Outbound campaigns with CSV import and a sliding-window dialer let teams run controlled outbound calling with scheduling and retry handling.
- Queue and operator management adds call distribution controls for live agent workflows and queue-backed routing.
- Hunt groups support sequential, random, and group dialing strategies for multi-destination failover and parallel ringing.
- Conference rooms powered by Asterisk ConfBridge enable multi-party sessions with moderator and participant handling.
- Callback flow support lets callers request a callback and routes those requests back into managed outbound processing.
- Audio upload, ffmpeg conversion, and offline Piper TTS provide local prompt creation without external TTS dependencies.
- Call recording capture with browser streaming and downloads gives operators direct access to stored call media.
- Live dashboard surfaces active calls, queue status, and recent runtime events for day-to-day operations.
- Call logs include execution traces and RTP quality scoring so teams can debug flow behavior and voice quality from one view.
- SIP capture adds live packet streaming, ladder visualization, and `.pcap` export for protocol-level troubleshooting.
- Diagnostics tools include trunk tests, SIP registration checks, and host resource metrics for runtime health monitoring.
- Asterisk log viewing with plain-English translation reduces telephony troubleshooting friction for non-specialist users.
- WireGuard VPN management adds peer lifecycle controls and QR onboarding for secure remote softphone access.
- SIP firewall capabilities provide auto-blocking, live security feed updates, and GeoIP-aware monitoring for abuse detection.
- Backup and restore includes manual/scheduled archives plus retention controls for operational recovery.
- IVR template import supports one-click template loading and JSON import for faster flow bootstrapping.
- A network preflight wizard runs installation readiness checks before production call traffic goes live.
