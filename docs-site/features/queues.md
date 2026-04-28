# Queues & Operators

## How a call enters a queue

Queue runtime is implemented in `stasis/src/executors/queue.executor.ts`.

1. `queue_id` is read from node config and validated against the `queues` table.
2. Optional queue prompt is resolved and played (`channel.play` or `bridges.play`).
3. If a free operator exists, Stasis pops one from Redis free set, creates a mixing bridge in ARI, adds caller + operator channels, and marks operator busy.
4. If no free operator is available, caller channel id is pushed to a Redis waiting list and the executor waits for either:
   - queue connect signal,
   - caller hangup (`StasisEnd`/`ChannelDestroyed`),
   - max wait timeout.

## Redis key structure used for queue state

From `stasis/src/engine/queueManager.ts` and queue executors:

- `queue:<queueId>:operators` (set): available operator ids
- `queue:<queueId>:busy` (set): busy operator ids
- `queue:<queueId>:waiting` (list): waiting customer channel ids
- `operator:<operatorId>:queue` (string): operator’s queue id
- `operator:<operatorId>:channel` (string): operator channel id
- `queue:<queueId>:customer:<customerChannelId>:channel` (string): mapped operator channel for connected customer

## How operator login/logout works

Mechanics are in `queue_login.executor.ts` + `queueManager.ts`:

- Caller enters queue-login node, enters PIN (DTMF), PIN is checked against bcrypt hashes for operators assigned to that queue.
- On successful auth, `loginOperator(queueId, operatorId, channelId)`:
  - writes operator queue/channel keys,
  - if customers are waiting, immediately bridges first waiting customer,
  - otherwise adds operator to free set.
- Operator channel is kept open; pressing `#` or channel end triggers logout.
- `logoutOperator()` removes operator from free/busy sets and clears operator keys.

## What the live dashboard shows and where data comes from

- Queue definitions, limits, and assigned operators come from Postgres via `backend/src/queues/queues.service.ts`.
- Operator live status is computed from Redis keys in `backend/src/operators/operators.service.ts`:
  - no `operator:<id>:queue` => `offline`
  - member of `queue:<queueId>:busy` => `busy`
  - otherwise => `available`

## No-agent and timeout behavior

From `queue.executor.ts`:

- If no free operators are present, caller is queued in `queue:<id>:waiting`.
- If caller hangs up while waiting, entry is removed and result is `abandoned`.
- If `max_wait_seconds` elapses, entry is removed and result is `timeout`.
- Flow routing after `connected`/`timeout`/`abandoned` is decided by normal edge resolution in the flow runtime.
