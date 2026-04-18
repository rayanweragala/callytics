# Testing

## Phase 17 completion summary

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
