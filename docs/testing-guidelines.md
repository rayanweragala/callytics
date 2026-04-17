# Testing Guidelines

## Overview
- Two test types: unit (`.unit.spec.ts`) and integration (`.int.spec.ts`)
- Unit tests: no DB, no network, no Docker required
- Integration tests: require Postgres only (`callytics_test` DB, auto-created by globalSetup)
- E2E: manual only, see `docs/testing.md`

## File naming and location
- Unit tests live next to the file they test: `foo.ts` -> `foo.unit.spec.ts`
- Integration tests live in the module folder: `flows/flows.int.spec.ts`
- Never name a test file just `.spec.ts`

## Unit test patterns
- Mock all I/O (DB, Redis, ARI channel, child processes) using `jest.fn()` or `jest.spyOn()`
- One `describe` block per function or class method
- Test the happy path first, then each failure/edge case as a separate `it()`
- Assert on return value and on side effects (for example, verify `channel.hangup()` was called)
- Example pattern for executor tests: construct a mock channel object with `jest.fn()` methods, call the executor, assert on both the resolved value and which mock methods were called

## Integration test patterns
- Each test file bootstraps the NestJS app via `getApp()` from `backend/test/app.ts`
- Call `truncateAll()` in `beforeEach` — never rely on leftover data from a prior test
- Each test creates its own data (no shared fixtures)
- Use `supertest` as `request(app.getHttpServer())`
- Assert on HTTP status first, then on response body shape
- For endpoints that depend on external services (Piper, AMI), mock at the service layer using `jest.spyOn()`

## What not to test
- Do not test NestJS framework behavior (routing, decorators, pipes) — trust the framework
- Do not test TypeORM/pg query internals
- Do not test third-party library behavior
- Focus on business logic, edge resolution, executor behavior, and API contract (status codes plus response shape)

## Mocking Piper
When testing audio TTS endpoints, mock the Piper execution so tests pass without the binary:
```ts
jest.spyOn(audioService as any, 'runCommand').mockImplementation(async (command: string, args: string[]) => {
  if (command === 'piper') {
    return { stdout: '', stderr: '' };
  }
  return { stdout: '', stderr: '' };
});
```
Adjust the mocked method name if the AudioService implementation changes.

## Adding new tests
- When adding a new node executor: add it to `stasis/src/executors/executors.unit.spec.ts` with at minimum a happy path and a hangup-mid-execution case
- When adding a new API endpoint: add it to the relevant `.int.spec.ts` file with at minimum a success case and a not-found or validation failure case
- When adding a new stasis source file (monitor, executor, engine): add a `foo.unit.spec.ts` next to it, add the file path to `collectCoverageFrom` in `stasis/jest.config.js`

## Stasis-specific notes
- Stasis has no integration tests — unit only
- When adding a new stasis source file (monitor, executor, engine): add a `foo.unit.spec.ts` next to it and add the file path to `collectCoverageFrom` in `stasis/jest.config.js`
