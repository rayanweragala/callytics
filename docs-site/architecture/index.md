# Architecture

## Overview

Callytics is a self-hosted call-center stack built around Asterisk, a Stasis call execution service, a NestJS backend, PostgreSQL, Redis, and a React frontend. Asterisk handles SIP and media, Stasis runs the active call logic, the backend owns the management API and operational features, PostgreSQL stores durable data, Redis carries live events and short-lived state, and the frontend gives users the browser interface.

The pieces are connected so call routing can be changed from the UI without manually editing dialplan files. Admins design and publish flows in the browser, the backend stores and prepares that configuration, and new calls are executed by the runtime against the published flow state.

## Service Breakdown

Asterisk is the telephony engine. It accepts SIP traffic, handles RTP media, manages bridges and recordings, and exposes the control interfaces used by the rest of the system to play audio, originate calls, join calls together, and end calls.

Stasis is the call execution runtime. It receives live call events from Asterisk, loads the published call flow, walks each step of the flow, sends commands back to Asterisk, and emits timeline, campaign, SIP, and quality events as the call progresses.

NestJS is the management backend. It serves the API used by the browser, manages configuration for extensions, trunks, flows, campaigns, firewall, VPN, backups, diagnostics, and recordings, and relays live operational events to connected clients.

PostgreSQL is the durable system database. It stores configuration, users, extensions, trunks, flows, flow versions, campaigns, call logs, recordings metadata, operators, queues, and other long-lived product data.

Redis is the live event and coordination layer. It carries telemetry between services, supports queue and operator coordination, distributes campaign and callback events, and provides the short-lived state needed for real-time dashboards.

Frontend is the React browser application. It gives admins and operators the UI for building flows, managing SIP resources, watching dashboards, reviewing logs, listening to recordings, and running diagnostics.

## Why Host Networking

Telephony is sensitive to address translation because SIP signaling and RTP media need to advertise and reach the correct host addresses. Host networking lets the telephony services bind directly to the server network stack, which avoids many Docker bridge and NAT problems that commonly break SIP audio paths.

This also keeps local control traffic between the call runtime and Asterisk simple. The runtime can reach Asterisk on the host loopback address while Asterisk uses the same host network namespace for SIP, RTP, ARI, and AMI.

The optional VPN service is different because it terminates WireGuard tunnels rather than owning SIP and RTP sockets directly. It can publish the VPN UDP port while still giving remote clients a private route into the phone system.

## Call Execution Path

1. A call arrives at Asterisk through a SIP trunk, extension, or internal route.
2. Asterisk hands the call to the Callytics call application.
3. The call runtime selects the correct published flow for that call.
4. The runtime starts at the entry point and moves through the flow one node at a time.
5. Each node performs its action, such as playing audio, collecting digits, checking business hours, transferring, queuing, recording voicemail, or ending the call.
6. Asterisk executes the low-level telephony work such as playback, bridge creation, outbound dialing, recording, and hangup.
7. The runtime publishes live call events while the call is active.
8. The backend consumes those events, stores the durable history, and sends real-time updates to the browser.
9. When the call ends, the final status, timeline, trace, and quality information become available in the call history.

## Redis as the Event Backbone

Redis is the event backbone between the services that handle live calls, dashboards, campaigns, callbacks, SIP status, firewall activity, packet capture, and quality metrics. It lets the call runtime publish fast operational events without forcing every consumer to be tightly coupled to the call execution process.

Redis also carries short-lived coordination state for features such as queues and operator availability. That makes it suitable for live state that changes frequently, while PostgreSQL remains the place for durable records and configuration.

## Real-Time Updates

The backend listens for operational events and converts them into browser updates over Socket.IO. This is how the UI can show active calls, queue movement, campaign progress, diagnostics, firewall activity, SIP traffic, and call timeline changes without requiring users to refresh the page.

Socket.IO keeps the browser subscribed to the areas the user is viewing. When new backend events arrive, the relevant page can update counters, tables, badges, timelines, and live panels immediately.
