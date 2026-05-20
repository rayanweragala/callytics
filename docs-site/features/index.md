# Feature Overview

Callytics is a self-hosted call center platform that combines telephony control, visual flow design, and operational tooling in one Linux-first deployment.

## Core call control

The platform includes a visual IVR flow builder with 13 node types, plus SIP extensions, SIP trunks, and inbound DID routing so teams can build and run real call paths without manual dialplan maintenance.

## Agent and customer routing

Queues, operators, hunt group strategies, conference rooms, and callback workflows are built in, covering core inbound handling and multi-destination routing patterns used by small and mid-size support teams.

## Outbound operations

Outbound campaigns support CSV import, scheduling, retry-aware contact handling, and sliding-window dialing to keep outbound traffic controlled and observable.

## Media and voice tooling

Audio upload, ffmpeg conversion, and offline Piper TTS are integrated into one prompt library, and call recordings are available for browser playback and direct download.

The browser softphone lets an operator register directly inside the dashboard, receive inbound calls, answer or reject them, and control mute or hangup without installing a separate SIP app.

## Monitoring and diagnostics

Live dashboard views show active calls, queue state, and events, while call logs include execution traces and RTP quality scoring for post-call analysis.

Packet-level SIP Capture includes live stream inspection, ladder visualization, and `.pcap` export, and Diagnostics adds trunk tests, SIP registration visibility, and host resource metrics.

Asterisk Logs adds plain-English translation support so common runtime issues are easier to understand and resolve.

## Security, connectivity, and resilience

WireGuard VPN peer management enables secure remote endpoint onboarding with QR provisioning, and the SIP firewall provides abuse detection with auto-blocking and live feed visibility.

Backup and Restore provides manual and scheduled archives with retention controls, and the preflight wizard validates network and service readiness before production traffic.

## Reuse and onboarding

Template import supports one-click IVR templates and JSON import paths to speed up initial setup and repeated deployment patterns.
