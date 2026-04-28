# Outbound Campaigns

## Sliding-window dialer logic

The dialer runs in `stasis/src/campaign-executor.ts`.

- A runtime is created per campaign with:
  - `queue` (pending contacts)
  - `activeByChannel` (active outbound channels)
  - counters (`dialedCount`, `answeredCount`, `failedCount`)
- `fillWindow()` keeps dialing while:
  - campaign is not stop-requested,
  - `activeByChannel.size < maxConcurrent`,
  - pending queue still has contacts.
- Each dial uses ARI `POST /ari/channels` with endpoint `PJSIP/<phone>@trunk-<trunkId>` and app args `campaign,<campaignId>,<contactId>`.

## Answered vs no-answer vs busy vs failed

`handleChannelEnd()` classifies outcome using `determineOutcome()`:

- `answered`: flow actually ran for that call (`flowRan=true`)
- `busy`: channel end cause text contains `busy`
- `no_answer`: cause contains `no answer`, `no_answer`, or `cancel`
- `failed`: everything else

Per-contact updates are published on `campaign:contact:update`, and aggregate counters on `campaign:stats:update`.

## Retry scheduling

Retry behavior is in Stasis runtime:

- Retries are only considered for `busy` and `no_answer`.
- Condition: `attemptNumber <= maxRetries`.
- When eligible, contact status is pushed back to pending after:
  - `setTimeout(retryIntervalMinutes * 60_000)`.
- Backend listener writes `next_retry_at = NOW() + interval` when status is `pending`.

## Campaign states

From `backend/src/campaigns/campaigns.service.ts` state transitions:

- `draft` -> `scheduled` (manual schedule)
- `scheduled` -> `running` (due-time scheduler)
- `running`/`scheduled` -> `cancelling` (stop requested)
- terminal states from events/fallback:
  - `completed`
  - `cancelled`

Deletion is restricted to `draft`, `cancelled`, or `completed`.

## How NestJS scheduling triggers execution

Scheduling path:

1. `CampaignsScheduler` runs every 60s (`@Cron('*/60 * * * * *')`).
2. `startDueCampaigns()` selects `status='scheduled'` and `scheduled_at <= NOW()`.
3. Each due campaign is updated to `running`.
4. Backend publishes `campaign:start:<id>` on Redis.
5. Stasis `CampaignExecutor` is pattern-subscribed to `campaign:start:*` and starts dialing for that campaign.
