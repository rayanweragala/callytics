# Diagnostics

Diagnostics brings the main health checks for the phone system into one place. It shows whether core services are reachable, how long the system has been running, and whether the telephony layer can communicate with trunks and registered endpoints.

You can test trunk health, review SIP registration status, inspect recent call failures, and look at SIP traffic from the browser. This reduces the time spent switching between shell commands, logs, and separate monitoring tools when investigating call problems.

The page also includes resource usage and plain-English log viewing so you can quickly tell whether an issue looks like configuration, provider connectivity, service health, or server capacity.

## Capabilities

- System health panel for ARI, AMI, Asterisk, PostgreSQL, Redis, and uptime
- Trunk health testing
- PJSIP qualify visibility
- SIP registration status
- Recent call failure analysis
- SIP traffic inspector
- Resource usage panel for CPU, memory, disk, active channels, and network I/O
- Plain-English Asterisk log viewer
- Grep-style log filtering
