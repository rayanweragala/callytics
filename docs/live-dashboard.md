# Live dashboard

The live dashboard is the part of the app that tells the user what is happening right now, not what happened yesterday.

## What it shows

### Active calls panel

Each live call row should show:

- Caller number or caller ID
- Direction: inbound, outbound, or internal
- Current state: ringing, queued, talking, voicemail, ended
- Current flow name
- Current node or step name
- Queue name if relevant
- Agent or extension if connected
- Call duration so far

### Queue status panel

Each queue card should show:

- Queue name
- Waiting callers count
- Available agents count
- Busy agents count
- Longest wait time
- Calls answered today
- Calls abandoned today

### Recent events panel

Short event feed showing:

- Call started
- Call answered
- Menu choice selected
- Queue entered
- Queue exited
- Transfer completed
- Voicemail left
- Call ended

### Service status panel

- Asterisk connection status
- AMI connection status
- API status
- Database status
- Redis status
- SIP trunk registration status

## Where the live data comes from

The main source is `AMI`, the Asterisk Manager Interface.

AMI gives us events such as:

- new channel created
- dial started
- bridge entered
- bridge left
- queue caller join
- queue caller leave
- hangup
- voicemail related events where available

The backend should keep a long-lived AMI connection and convert raw Asterisk events into app-level events. Raw AMI events are too noisy for direct browser use.

## Backend event flow

1. Asterisk emits AMI events
2. Backend AMI client receives them
3. Event mapper resolves channel data into a known call session
4. Live call state is updated in Redis
5. Socket.io gateway publishes app-level updates to connected browsers
6. Important events are also persisted to the call history tables

## Browser update model

The dashboard should load with one initial snapshot over REST, then switch to Socket.io for updates.

That means:

- `GET /api/calls/live` provides the starting state
- Socket.io keeps the screen fresh after that

This avoids waiting for socket history replay every time the page opens.

## Socket.io events

### `dashboard:initial`

- Sent when the dashboard socket session is ready
- Carries:
  - current counters
  - current active calls
  - current queue summary
  - service status

### `call:created`

- Fired when a new live call appears
- Carries:
  - `callId`
  - `callerNumber`
  - `direction`
  - `startedAt`
  - `flowId`
  - `currentState`

### `call:updated`

- Fired when a live call changes state
- Carries:
  - `callId`
  - `currentState`
  - `currentNodeKey`
  - `queueName`
  - `agentExtension`
  - `durationSeconds`

### `call:ended`

- Fired when a call leaves live state
- Carries:
  - `callId`
  - `endedAt`
  - `endReason`
  - `durationSeconds`

### `queue:updated`

- Fired when queue metrics change
- Carries:
  - `queueName`
  - `waitingCount`
  - `availableAgents`
  - `busyAgents`
  - `longestWaitSeconds`

### `event:recent`

- Fired for the recent event feed
- Carries:
  - `eventType`
  - `callId`
  - `message`
  - `timestamp`
  - optional extra fields such as queue or selected digit

### `service:status`

- Fired when service health changes
- Carries:
  - service name
  - new status
  - optional diagnostic message

## Rough UI shape

The dashboard should be a practical operations screen:

- Top row for headline counters
- Left column for active calls
- Right column for queue cards and service status
- Bottom or side feed for recent events

The first version does not need a wallboard design. It just needs to answer:

- what is happening now
- are callers waiting
- are services healthy
- where did that call go
