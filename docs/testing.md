# Testing

## Phase 23 current baseline

Stasis:   134 passed  (+8 from Phase 23)
Backend:  220 passed  (+10 from Phase 23)
Frontend: 255 passed  (+15 from Phase 23)
CI:       all green

## Phase 23 test files

stasis/src/lib/mosScore.test.ts
  - MOS ≥ 4.0 for zero jitter + zero loss (expect ~4.4)
  - MOS threshold boundary at 4.0 (good → fair)
  - MOS threshold boundary at 3.0 (fair → poor)
  - High jitter (80ms), low loss → fair/poor
  - Low jitter, high loss (5%) → poor
  - Clamps at 1.0 floor (extreme loss + jitter)
  - Clamps at 5.0 ceiling (perfect conditions)

stasis/src/handlers/rtcp.handler.test.ts
  - Extracts jitter, packetsLost, packetsReceived, RTT from RTCPReceived event
  - Publishes to callytics:rtp-quality with correct shape
  - Handles RTCPSent event and upserts with worse values
  - Handles missing callId gracefully (no publish, no throw)

backend/src/quality/quality.service.unit.spec.ts
  - findByCallId returns quality record
  - findByCallId returns null for unknown callId
  - consumeStream writes to DB on new Redis entry
  - upsert overwrites with worse values on second RTCP direction

backend/src/quality/quality.int.spec.ts
  - GET /quality/:callId returns 200 with correct shape
  - GET /quality/:callId returns 404 when no record exists
  - Redis consumer writes and DB record is queryable

frontend/src/lib/mosLabel.test.ts
  - jitter < 20ms → "excellent"
  - jitter 20–50ms → "slight"
  - jitter > 50ms → "high"
  - packet loss < 1% → "none"
  - packet loss 1–3% → "low"
  - packet loss > 3% → "elevated"
  - RTT < 50ms → "normal"
  - RTT 50–150ms → "moderate"
  - RTT > 150ms → "high"

frontend/src/components/quality/QualityDrawer.test.tsx
  - Renders MOS score with correct colour class (good/fair/poor)
  - Renders jitter, packet loss, RTT rows with plain-English labels
  - "View in Capture" button navigates to /capture?callId=<id>
  - Renders grey state when quality data is null
  - Drawer opens and closes correctly

frontend/src/components/quality/MosGauge.test.tsx
  - Renders bar at correct fill percentage
  - Applies correct colour class per grade

frontend/src/pages/CallLogsPage.test.tsx (additions)
  - MOS column renders green badge for good calls
  - MOS column renders amber badge for fair calls
  - MOS column renders red badge for poor calls
  - MOS column renders grey dash when no quality data
  - Clicking MOS badge opens QualityDrawer
  - Clicking row body still opens ExecutionTrace drawer (not quality)

## Phase 17 completion summary (historical)

- Stasis test suite: **58 tests** (`npm run test:ci` in `stasis/`)
- Backend test suite: **85 tests** (`npm run test:ci` in `backend/`)
- Frontend test suite: **126 tests** (`npm run test:ci` in `frontend/`)

Coverage thresholds enforced in CI:
- Stasis: global lines >= 70%
- Backend: global lines >= 70%
- Frontend: lines >= 70%, branches >= 60%, functions >= 70%, statements >= 70%

## GitHub Actions CI pipeline

The repository CI workflow lives at `.github/workflows/ci.yml` and runs on pushes/PRs to `dev` and `main`.

Pipeline jobs:
1. `stasis-test` — installs `stasis/`, runs `npm run test:ci`, uploads `stasis/coverage`
2. `backend-test` — starts Postgres service, runs backend `npm run test:ci`, uploads `backend/coverage`
3. `frontend-test` — runs frontend `npm run test:ci`, uploads `frontend/coverage`
4. `build-check` — runs TypeScript no-emit checks for frontend, backend, and stasis after tests pass

## Running unit tests
```bash
cd backend
npm run test:unit
```

## Running integration tests
Requires a running Postgres (Docker or local). No other services needed.
```bash
cd backend
npm run test:int
```

## Running all tests
```bash
cd backend
npm test
```

## Stasis tests
```bash
cd stasis
npm run test:ci
```
- Runs all stasis tests with coverage

```bash
cd stasis
npm test
```
- Runs stasis tests without coverage

- Stasis tests are unit-only: no DB, no Docker, no integration tests
- File naming: `foo.ts` -> `foo.unit.spec.ts`, next to the file it tests
- When adding a new stasis source file, add it to `collectCoverageFrom` in `stasis/jest.config.js` or coverage will not be measured for it

## E2E call tests (manual)

Requires full Docker stack running and softphones/extensions configured (`test-phone` caller and extension `2001` callee).

1. Start the stack:
```bash
docker compose up -d
```
2. Tail runtime logs in a second terminal:
```bash
docker compose logs stasis -f
```
3. Place the call from caller to DID `1234` (`sip:test-phone@<host>:5080`)
4. Drive the IVR path:
   - Press `2` at first menu
   - Press `4` at submenu to reach hunt node
5. Verify runtime sequence in logs:
   - `Executing node: menu` with correct `Node result`
   - `Executing node: hunt`
   - Hunt originate attempts toward destination `2001`
   - On answer, bridge-add log for inbound + outbound channels
6. Hang up caller and verify cleanup:
   - Caller `StasisEnd`
   - Outbound leg hangs up (no orphan channel)
   - Inbound bridge destroy + recording persistence logs

Recommended repeat checks:
- Invalid DTMF + timeout loops still recover correctly
- Hunt retry behavior when destination is unavailable
- Final no-answer route when all hunt attempts fail

## Phase 18 added tests

- **Backend**: `diagnostics.service.unit.spec.ts`, `diagnostics.int.spec.ts`, `flows.service.unit.spec.ts` (config validation)
- **Frontend**: `NodeConfigPanel.test.tsx`, `AudioPage.test.tsx`, `DiagnosticsPage.test.tsx`, `CallLogsPage.test.tsx`
- **Stasis**: `sipTrafficMonitor.unit.spec.ts`

### Phase 19 additions
- `stasis/src/executors/voicemail.executor.unit.spec.ts` — 5 tests covering prompt playback order, hangup mid-recording, zero duration guard, recording independence
- `stasis/src/executors/business_hours.executor.unit.spec.ts` — open/closed logic for different times and days
- `backend/src/call-logs/call-logs.service.unit.spec.ts` — trace endpoint
- `backend/src/templates/templates.int.spec.ts` — import flow integration test

## Phase 21 added tests

- **Stasis**: `stasis/src/sipTrafficMonitor.unit.spec.ts`
  - Call-ID extraction from raw SIP payloads (present, missing, mid-message, empty)
- **Backend**: `backend/src/diagnostics/diagnostics.service.unit.spec.ts`
  - `sip_messages` persistence path from Redis SIP events, including `callId = null`
  - Field mapping verification: `from -> from_uri`, `to -> to_uri`, `responseCode -> response_code`
- **Backend**: `backend/src/diagnostics/diagnostics.int.spec.ts`
  - `GET /diagnostics/sip-messages` base and `callId`-filtered responses
  - `GET /diagnostics/sip-messages/:callId` response behavior for existing and missing Call-ID
- **Frontend**: `frontend/src/components/__tests__/SipLadderDiagram.test.tsx`
  - SVG ladder rendering, SIP labels, chronological row ordering, failure highlighting, empty-message rendering
- **Frontend**: `frontend/src/pages/__tests__/DiagnosticsPage.phase21.test.tsx`
  - Panel D SIP Traffic Inspector drill-down behavior
  - Panel E Recent Call Failures drill-down and failure-highlighted ladder behavior
