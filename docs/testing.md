# Testing

## Tiered Test Workflow

Use the same three command tiers everywhere in the repo.

| Tier | Command | When to use |
|---|---|---|
| `test:fast` | local quick check | After every change and before asking for review |
| `test:ci` | CI-equivalent suite with coverage | Before opening a PR and in GitHub Actions |
| `test:full` | CI suite plus open-handle detection | Periodic deep validation and leak debugging |

### Root workspace

```bash
npm run test:fast
npm run test:ci
npm run test:full
```

### Frontend

```bash
cd frontend
npm run test:fast
npm run test:ci
npm run test:full
```

- `test:fast` runs Vitest without coverage and with verbose timing output.
- `test:ci` runs the frontend suite with coverage.
- `test:full` runs coverage plus verbose output for deeper investigation.

### Backend

```bash
cd backend
npm run test:fast
npm run test:unit
npm run test:int
npm run test:ci
npm run test:full
```

- `test:fast` is unit-only and does not require Postgres.
- `test:int` runs the integration project in band.
- `test:ci` matches the backend CI gate with coverage.
- `test:full` adds `--detectOpenHandles` for leak hunting.

### Stasis

```bash
cd stasis
npm run test:fast
npm run test:unit
npm run test:ci
npm run test:full
```

- Stasis tests are unit-only.
- `test:fast` skips coverage.
- `test:full` adds `--detectOpenHandles`.

## Frontend warning policy

Frontend tests run under a strict console policy from `frontend/src/test/setup.ts`.

Rules:
- Any `console.warn` or `console.error` is treated as a test failure in CI.
- There is no warning allowlist.
- If a test emits a warning, fix the test or the component behavior instead of suppressing it.

Current enforcement strategy:
- Router-based tests must use `renderWithRouter` from `frontend/src/test/renderWithRouter.tsx`.
- Async UI interactions must wait for the resulting updates with `await`, `findBy*`, `waitFor`, or timer flushing as appropriate.
- New tests should avoid ad-hoc router wrappers and should not introduce noisy console output.

### Troubleshooting frontend warnings

1. React Router future-flag warnings
   - Use `renderWithRouter(...)` instead of manually mounting `MemoryRouter`.
   - Pass `initialEntries` through the helper when a test needs query params or route state.

2. `act(...)` warnings
   - Prefer `await userEvent.click(...)`, `await userEvent.type(...)`, and `findBy*` queries.
   - When fake timers are involved, advance timers inside `act(...)` or use async timer helpers.
   - Wait for the post-interaction UI state before asserting.

3. JSDOM navigation warnings
   - Do not trigger real navigation APIs in unit tests.
   - Mock the navigation boundary or assert against the callback that would navigate.

## GitHub Actions CI pipeline

The repository CI workflow lives at `.github/workflows/ci.yml` and keeps the existing four-job topology.

Pipeline jobs:
1. `stasis-test`
   - installs `stasis/`
   - runs `npm run test:ci`
   - uploads `stasis/coverage`
   - writes a job summary with test summary output and timestamps
2. `backend-test`
   - starts Postgres and Redis services
   - runs `npm run test:unit`
   - runs `npm run test:int -- --coverage`
   - uploads `backend/coverage`
   - writes a job summary with separate unit and integration timing
3. `frontend-test`
   - runs `npm run test:ci`
   - uploads `frontend/coverage`
   - enforces the frontend warning policy automatically through `CI=true`
4. `build-check`
   - runs TypeScript no-emit checks for frontend, backend, and stasis after tests pass

## Manual E2E call tests

Requires the full Docker stack and softphones/extensions configured (`test-phone` caller and extension `2001` callee).

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

## Coverage thresholds

Coverage thresholds enforced in CI:
- Stasis: global lines >= 70%
- Backend: global lines >= 70%
- Frontend: lines >= 68%, branches >= 60%, functions >= 63%, statements >= 70%

## Historical baselines

### Phase 23 current baseline

- Stasis: 134 passed
- Backend: 220 passed
- Frontend: 255 passed
- CI: all green

### Phase 27 added tests (trunk testing tools)

- `backend/src/trunks/trunks.service.unit.spec.ts`
  - `testOutbound` publishes `trunk:test:outbound` with trunkId/number/audioFileId/testCallId
  - `testInbound` publishes `trunk:test:inbound` with trunkId/testCallId
  - `getTestCallStatus` returns parsed JSON status payload from Redis
- `stasis/src/trunk-test.util.unit.spec.ts`
  - Valid inbound Redis payload parsing
  - Invalid payload rejection
  - Inbound originate body builder shape
- `frontend/src/lib/api.test.ts`
  - `testTrunkOutbound` endpoint/body mapping
  - `testTrunkInbound` endpoint mapping
  - `getTrunkTestStatus` endpoint mapping
- `frontend/src/pages/TrunksPage.test.tsx`
  - Row action buttons render as `[edit] [delete] [···]`
  - Overflow menu opens and `Quick Test` triggers `testTrunk(id)`

Run only the Phase 27 test files:
```bash
npm run test:unit --workspace backend -- src/trunks/trunks.service.unit.spec.ts
npm run test --workspace stasis -- src/trunk-test.util.unit.spec.ts
npm run test --workspace frontend -- src/lib/api.test.ts src/pages/TrunksPage.test.tsx
```
