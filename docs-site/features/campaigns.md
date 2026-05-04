# Outbound Campaigns

Outbound Campaigns let you call a list of contacts without manually dialing each number. You upload a CSV contact list, choose the campaign settings, and schedule when the campaign should run.

The dialer uses a sliding concurrency window so the campaign keeps multiple calls in progress without overwhelming operators or trunks. Busy and no-answer outcomes can be retried according to the campaign rules, while each contact keeps a clear attempt history.

Campaigns move through a simple lifecycle from draft to scheduled, running, stopping, and completed states. Live counters show progress while the campaign is active, making it easy to see how many contacts were dialed, answered, failed, or are still pending.

## How the dialler works

### Campaign configuration

Each campaign has three required settings:

- **Contact list** — a CSV of phone numbers to dial
- **Trunk** — the SIP trunk to use for all outbound calls
- **Max concurrency** — the maximum number of simultaneous active calls

### Scheduling and execution

A NestJS cron job checks for campaigns whose scheduled start time has been reached. When a campaign is due, the cron job hands execution to the Stasis campaign executor.

### Sliding window loop

The Stasis campaign executor runs a sliding window loop:

```
┌─────────────────────────────────────────┐
│           sliding window dialler        │
│                                         │
│  maxConcurrent = 3                      │
│                                         │
│  [call 1 ████████░░░░░░░░░░░░░░░░░░]   │
│  [call 2 ████░░░░░░░░░░░░░░░░░░░░░░]   │
│  [call 3 ██████████░░░░░░░░░░░░░░░░]   │
│            ▲                            │
│            └─ when any call ends,       │
│               next contact dials        │
└─────────────────────────────────────────┘
```

1. Check how many calls are currently active (tracked in Redis)
2. While `active calls < maxConcurrent`, dial the next contact from the list
3. Apply `formatDialNumber` with the trunk's `dial_format` to clean and format the number before dialing
4. When a call ends, decrement the active call count and fill the window again with the next contact
5. Continue until all contacts are dialled, or until the campaign is paused or stopped from the UI

### Call outcomes

Each outbound call result is written back to the database via Redis events published by Stasis:

| Outcome | Description |
|---|---|
| `answered` | Caller picked up |
| `no-answer` | No response within the configured timeout |
| `busy` | Destination returned busy |
| `failed` | Call could not be placed (trunk error, invalid number) |

Busy and no-answer contacts can be retried based on the campaign retry settings. Each contact record tracks the full attempt history.

## Capabilities

- CSV contact upload
- Campaign scheduling
- Sliding-window concurrent dialing
- Retry logic for busy outcomes
- Retry logic for no-answer outcomes
- Campaign state lifecycle tracking
- Live progress counters
- Per-contact attempt history
