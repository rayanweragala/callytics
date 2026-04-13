# IVR flow engine

This design uses `ARI` with a `Stasis` app. The visual flow lives in our database. The call logic lives in our Node.js code. Asterisk only receives the call and hands control to the app.

## High level picture

There are three parts:

- A small static dialplan inside Asterisk
- A Node.js Stasis app connected to ARI
- A flow definition stored in PostgreSQL across `call_flows`, `flow_versions`, `flow_nodes`, and `flow_edges`

The static dialplan does one thing: send incoming calls into the Stasis app. It does not contain the IVR logic. It does not change when a user edits a flow.

Once the call enters Stasis, our app decides everything that happens next.

## Asterisk side

On the Asterisk side, the dialplan is intentionally small.

- A call arrives on a SIP trunk or local endpoint
- Asterisk matches the call to a basic extension
- That extension sends the call into our Stasis app
- After that, Asterisk waits for instructions from the app

That means Asterisk is still doing media and channel work, but it is not making business decisions about the flow.

## Stasis app side

The Stasis app is a long-running Node.js process.

It connects to ARI in two ways:

- A persistent WebSocket for events
- HTTP requests to control channels, play media, create bridges, and hang up calls

When a call enters Stasis, Asterisk sends a `StasisStart` event over the ARI event stream.

That event includes details such as:

- channel ID
- caller ID
- dialed number or extension
- timestamps
- channel state

The app uses that data to decide which flow should run. It loads the published flow from the database, builds an in-memory execution state for the call, and walks through the nodes one step at a time.

## Where the flow lives

The visual flow builder persists a flow in relational tables in PostgreSQL. At runtime the Stasis app loads those rows and assembles them into an in-memory flow object.

Each node stores:

- a node ID
- a node type
- a config object
- outgoing connections

Each connection says what the next node is for a given result, such as:

- default
- digit `1`
- digit `2`
- timeout
- error
- success

The Stasis app reads these rows and treats the flow like a state machine:

- load current node
- execute node
- collect result
- choose next edge
- move to next node

That is the core runtime model.


## Current implemented runtime behavior

After Phase 10 the runtime now exists in code, not just in design. The Stasis app currently:

- runs startup migrations for the flow and call-log tables
- seeds a published `Test Flow` only when flow 1 does not already exist with saved nodes
- loads the first matching published flow from PostgreSQL
- creates an in-memory session per call
- executes the current node
- resolves conditional edges by `condition` first, then falls back to `branchKey` and `default`
- removes the session when the flow ends or the channel hangs up
- ignores `StasisStart` events for the `h` extension so the hangup path does not re-run flow logic

The currently implemented node executors are:

- `start`
- `play_audio`
- `get_digits`
- `branch`
- `transfer`
- `voicemail` placeholder
- `hangup`
- `set_variable`

The original seed flow is still:

- `start` -> `greet` -> `menu` -> `bye`
- built-in Asterisk sound `tt-monkeys` for greeting
- built-in Asterisk sound `tt-weasels` for digit collection prompt
- `menu` routes `1`, `2`, `timeout`, and `default` to `bye`

But once a user saves a richer flow in the builder, that saved flow is now treated as source-of-truth and is no longer overwritten on Stasis restart.

## Runtime networking change

The first live-call debugging pass changed the infrastructure around the runtime.

Old state:

- `asterisk` on host networking
- `stasis` on bridge networking
- `stasis` attempting to reach ARI through Docker host aliases

New working state:

- `asterisk` on `network_mode: host`
- `stasis` on `network_mode: host`
- `stasis` uses `ARI_URL=http://127.0.0.1:8088`
- `stasis` uses `DB_HOST=127.0.0.1`

This change fixed ARI connectivity and allowed the `callytics` Stasis app to register correctly in Asterisk.

## ARI vs AMI

`ARI` and `AMI` both stay in the system, but their jobs are different.

### ARI

- Used for call control
- Receives `StasisStart` and other app-level events
- Sends REST commands to play media, create bridges, answer channels, and hang up

### AMI

- Used for read-only monitoring
- Tracks active calls, channel state, durations, and queue status
- Feeds the live dashboard through Socket.io

AMI does not control calls in this design. All call control belongs to ARI and the Stasis app.

## Call lifecycle

This is the normal path for one incoming call:

1. A call reaches Asterisk
2. Asterisk routes it into the Stasis app through the fixed dialplan entry
3. ARI emits `StasisStart`
4. The Node.js app receives the event
5. The app looks up the published flow for that entry point
6. The app creates runtime state for this call
7. The app executes the first node
8. After each node finishes, the app moves to the next node based on the result
9. The app keeps going until the call transfers, reaches voicemail, or hangs up

This gives us one important property: changing a flow means changing database data, not changing Asterisk config.

## Node execution model

Each node type maps to one piece of runtime behavior in the Stasis app. In many cases, one node needs more than one ARI request. That is normal. ARI gives low-level call control, so some higher-level IVR actions need a small sequence of calls and event handling.

## Node types

### Play Audio

Purpose:

- Play one audio file to the caller
- Wait until playback finishes before moving on

How it runs:

1. The runtime first tries to resolve `audio_file_id` from the node config through `audioResolver.ts`
2. If found, it loads `storage_path_converted` from `audio_files` and maps it to `sound:callytics/<id>` for Asterisk playback
3. Asterisk resolves that `sound:` lookup to `callytics/<id>.ulaw` inside the mounted sounds directory
4. If no `audio_file_id` is set or no ready asset exists, it falls back to `audio_file_path` for built-in or static sounds
5. The app makes an ARI request to play media on the live channel
6. Asterisk starts playback
7. The app waits for the playback finished event
8. When playback ends, the node returns `completed`

Main ARI control:

- `POST /channels/{channelId}/play`

Notes:

- `audioResolver.ts` is the bridge between database-backed audio assets and Asterisk sound playback
- In the current runtime, `sound:callytics/<id>` resolves to the `.ulaw` asset in the mounted Asterisk sounds directory
- Built-in/static sound paths still work as fallback
- The app still has to watch for hangup while playback is happening

### Get Digits

Purpose:

- Play a prompt
- Wait for a keypress
- Return the digit or a timeout result

How it runs:

1. The runtime first tries to resolve `prompt_audio_file_id` from the node config through `audioResolver.ts`
2. If found, it loads the converted asset path from `audio_files` and maps it into the Asterisk sounds mount
3. Asterisk resolves `sound:callytics/<id>` to the `.ulaw` telephony asset in the mounted sounds directory
4. If no database-backed prompt asset exists, it falls back to `prompt_path` for built-in or static sounds
5. The app starts prompt playback on the channel
6. The app listens for DTMF events on the ARI event stream
7. The app starts a timeout timer
8. If the caller presses a key, the node returns that digit
9. If the timer expires first, the node returns `timeout`

Main ARI control:

- `POST /channels/{channelId}/play`
- ARI event handling for channel DTMF events

Notes:

- ARI does not turn this into one magic IVR call for us
- We have to coordinate playback, DTMF, and timeout logic in our own code
- Database-backed prompt assets and fallback prompt paths are both supported

### Branch

Purpose:

- Decide which next node to follow based on the last result

How it runs:

1. The app reads the current runtime state
2. It checks the branch rules on the node or outgoing edges
3. It picks the matching next node

Main ARI control:

- None directly

Notes:

- This is app logic, not an Asterisk media action
- ARI is not called here unless the next node needs it

### Transfer

Purpose:

- Send the caller to a SIP extension or external number

How it runs:

1. The app creates an outbound channel to the target
2. The app waits for the outbound side to answer or fail
3. If answered, the app creates a bridge
4. The app adds both channels to the bridge
5. If the outbound side fails, the node returns `failed` so the flow can branch

Main ARI control:

- `POST /channels/create` or originate equivalent for the target leg
- `POST /bridges`
- `POST /bridges/{bridgeId}/addChannel`

Notes:

- This is more complex than a dialplan `Dial()` step
- The app has to manage answer, failure, timeout, and cleanup itself

### Voicemail

Purpose:

- Record a caller message and save it

How it runs:

1. The app optionally plays a voicemail greeting
2. The app starts a channel recording through ARI
3. The caller speaks
4. The app stops recording on silence, timeout, or hangup
5. The recording metadata is saved in the database

Main ARI control:

- `POST /channels/{channelId}/play` for the greeting
- `POST /channels/{channelId}/record`

Notes:

- This is not the same as using the built-in Asterisk voicemail application
- We are handling voicemail as an app-managed recording flow
- That gives us more control, but it also means we own more logic

### Hangup

Purpose:

- End the call cleanly

How it runs:

1. The app sends a hangup request for the channel
2. The app marks the call as finished in runtime state and history

Main ARI control:

- `DELETE /channels/{channelId}`

Notes:

- Simple, but the app still needs to handle cases where the caller hung up first

### Set Variable

Purpose:

- Store a value for later use in the flow

How it runs:

1. The app computes the value
2. The app stores it in the in-memory call session state
3. If needed, the app also writes it onto the channel for Asterisk-side visibility

Main ARI control:

- `POST /channels/{channelId}/variable`

Notes:

- Some variables may live only in Node.js memory
- Some may also be copied to the channel if we want them visible to Asterisk or CDR tooling

### HTTP Request

Purpose:

- Call an external webhook during the flow
- Use the response to decide what happens next

How it runs:

1. The app sends an HTTP request from Node.js to the external service
2. The app waits for the response or timeout
3. The app stores useful response fields in call variables
4. The flow moves to the next node based on success, failure, or returned data

Main ARI control:

- None directly

Notes:

- This is app logic, not an Asterisk action
- It is useful for CRM lookups, lead routing, or checking account state
- It also adds failure cases, so timeouts and retries need clear rules

## Simple example flow

Flow text:

`Thank you for calling. Press 1 for sales, press 2 for support, press 3 to leave a voicemail.`

### What happens when the call arrives

1. A call reaches Asterisk from a SIP trunk or local endpoint
2. Asterisk sends the call into the Stasis app through the fixed dialplan entry
3. ARI emits `StasisStart`
4. The Node.js app receives the event and gets the channel ID and caller details
5. The app looks up which published flow matches this entry point
6. The app loads the flow JSON from the database
7. The app answers the call if needed
8. The app executes the first node

### First node: menu prompt

1. The first step is a `Get Digits` style menu node
2. The app starts playback of the menu prompt through ARI
3. The caller hears: `Thank you for calling. Press 1 for sales, press 2 for support, press 3 to leave a voicemail`
4. While the prompt is playing or right after it finishes, the app listens for DTMF input
5. The app waits up to the configured timeout
6. When a keypress arrives, the node returns that digit to the runtime

### If the caller presses 1

1. The `Branch` logic matches digit `1`
2. The next node is `Transfer` to the sales target
3. The app creates an outbound call to the sales extension or queue target
4. When the target answers, the app bridges the caller and the sales side
5. From that point, the two call legs talk through Asterisk

### If the caller presses 2

1. The `Branch` logic matches digit `2`
2. The next node is `Transfer` to the support target
3. The app creates the outbound support leg
4. If support answers, the app creates a bridge and joins both channels
5. If support does not answer, the flow can return to another node such as voicemail or hangup

### If the caller presses 3

1. The `Branch` logic matches digit `3`
2. The next node is `Voicemail`
3. The app optionally plays a short voicemail greeting
4. The app starts recording through ARI
5. The caller leaves a message
6. The app stops recording and stores the file metadata
7. The flow ends with `Hangup`

### If the caller presses nothing

1. The `Get Digits` node returns `timeout`
2. The `Branch` logic chooses the timeout edge
3. That can replay the menu, send the call to voicemail, or hang up

## Honest complexity notes

This design is cleaner at the product level, but it is not free.

Hard parts include:

- tracking call state correctly across async ARI events
- handling transfers and bridge cleanup
- dealing with callers hanging up in the middle of a step
- making digit collection feel reliable
- deciding what state lives in memory, Redis, or the database

So the architecture is better aligned with the product, but the runtime engine will need careful engineering.


## Builder status after Phase 6

There is now a working React Flow editor on the frontend that can:

- load the latest stored version of a flow from the backend
- render nodes and edges on a canvas
- edit node labels and supported config fields
- create and delete nodes
- create, delete, and reconnect edges
- save the edited graph back through the backend CRUD API

This is still a thin slice, but it gives the runtime engine a real visual editor instead of static seeded data only.


## Phase 8 builder integration

The flow builder now exposes database-backed audio selection in node config:

- `play_audio` nodes can select `audio_file_id` from the shared searchable audio picker
- `get_digits` nodes can select `prompt_audio_file_id` from the same picker
- Static path fields remain available for built-in or manual sound paths
- When an asset ID is selected, the runtime prefers that database-backed asset and only falls back to the path fields if no ready asset is found
