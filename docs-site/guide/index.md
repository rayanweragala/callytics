# Getting Started

`callytics` is a self-hosted call center platform for Linux that installs with one command. It wraps the power of Asterisk in a modern, developer-friendly stack including a visual IVR builder, outbound dialer, and a built-in SIP firewall.

## Why callytics?

Telephony is traditionally hard. You usually have two choices:
1. **Hosted APIs (Twilio, Genesys):** Great to start, but bills scale fast with per-minute and per-feature pricing.
2. **Raw PBX (FreePBX, Asterisk):** Powerful and free, but requires editing complex config files and deep telephony knowledge.

Callytics bridges this gap. It gives you the control and cost-savings of a self-hosted Asterisk stack with the ease of use of a modern web application.

## Core Features
- **Visual IVR Builder:** Drag-and-drop call flows. Changes apply instantly without reloading Asterisk.
- **Outbound Campaigns:** Load contacts via CSV and run automated dialing schedules.
- **WireGuard VPN:** Securely connect remote softphones without exposing SIP ports to the public internet.
- **SIP Firewall:** Automatic source-IP blocking based on registration failure thresholds.
- **Resource Monitoring:** Live CPU, memory, and disk telemetry for your telephony node.

## Who is it for?
- **Small Businesses:** Need IVR, routing, and basic reporting without enterprise pricing.
- **Developers:** Want a local phone system they can test and automate.
- **Agencies:** Setting up phone systems for multiple clients on private infrastructure.
- **Startups:** Need a working call flow quickly before upgrading to a hosted stack.
