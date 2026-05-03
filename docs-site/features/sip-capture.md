# SIP Capture

SIP Capture gives you a live view of SIP signaling as it moves through the system. It helps troubleshoot registration problems, trunk issues, call setup failures, and provider-side disputes without leaving the Callytics UI.

The capture view can be filtered by method, Call-ID, trunk, and time range so you can narrow the stream to the traffic that matters. For a completed call, the per-call ladder diagram shows the SIP conversation in sequence, making it easier to understand where a call succeeded or failed.

## How it works

SIP Capture has two parallel data paths: an AMI-based path that is always active, and an optional tshark path for raw packet capture.

### AMI PJSIP logger path

This path is always active when the system is running.

1. Stasis enables `pjsip set logger on` via AMI on startup
2. Asterisk emits parsed SIP messages as AMI events
3. Stasis receives these AMI events and publishes them to the Redis pub/sub channel `callytics:sip-traffic`
4. The NestJS backend subscribes to `callytics:sip-traffic` and relays each message to the browser via Socket.IO (`sip:traffic` event)
5. The SIP Capture page in the browser receives the stream and displays messages in real time

### tshark path

This path requires `TSHARK_ENABLED=true` in the Asterisk container environment.

1. A capture sidecar process starts inside the Asterisk container and runs `tshark -i any -f "udp port 5080"` continuously
2. The sidecar restarts automatically if tshark exits
3. Raw captured packets are published to the Redis stream `callytics:sip-capture`
4. The backend consumes the stream and relays packets to the browser via Socket.IO (`sip:capture-packet` event)

### Per-call filtering

Each SIP message is stored with the value of its `Call-ID` header. The UI uses this to filter the capture stream to a single SIP dialog.

When you open a specific call in Call Logs and click the SIP Capture link, the view is pre-filtered by that call's Call-ID. If the Callytics internal call ID does not map directly to a SIP Call-ID, the UI falls back to matching by timestamp proximity — finding SIP messages within a small time window around the call.

### SIP ladder diagram

The per-call SIP ladder diagram is built entirely in the browser in `SipLadderPanel.tsx`. The backend returns the SIP messages for a call as structured data. The frontend renders the SVG ladder diagram client-side from that data — no server-side rendering is involved.

### Capture path overview

```
Asterisk PJSIP logger          tshark sidecar
        │                            │
        │ AMI events                 │ udp port 5080
        ▼                            ▼
   callytics:sip-traffic      callytics:sip-capture
   (Redis pub/sub)             (Redis stream)
        │                            │
        └────────────┬───────────────┘
                     ▼
               NestJS backend
               Socket.IO
                     │
                     ▼
                  Browser
            ┌─────────────────┐
            │  packet table   │
            │  SIP ladder SVG │
            │  .pcap export   │
            └─────────────────┘
```

## Capabilities

- Live SIP packet stream
- Method, Call-ID, trunk, and time filters
- Per-call SIP ladder diagram
- Historical packet retrieval for completed calls
- Rule-based verdict banner for quick interpretation
- Packet header inspection
- PCAP export for a selected dialog
- Bulk PCAP export from the capture view
- Deep link from call logs to capture filtered by Call-ID
