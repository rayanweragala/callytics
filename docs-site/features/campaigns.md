# Outbound Campaigns

Outbound Campaigns help teams call a list of contacts without manually dialing each number. Users upload a CSV contact list, choose the campaign settings, and schedule when the campaign should run.

The dialer uses a sliding concurrency window so the campaign can keep multiple calls in progress without overwhelming operators or trunks. Busy and no-answer outcomes can be retried according to the campaign rules, while each contact keeps a clear attempt history.

Campaigns move through a simple lifecycle from draft to scheduled, running, stopping, and completed states. Live counters show progress while the campaign is active, making it easier to see how many contacts were dialed, answered, failed, or are still pending.

## Capabilities

- CSV contact upload
- Campaign scheduling
- Sliding-window concurrent dialing
- Retry logic for busy outcomes
- Retry logic for no-answer outcomes
- Campaign state lifecycle tracking
- Live progress counters
- Per-contact attempt history
