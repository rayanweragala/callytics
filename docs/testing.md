# Testing

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

## E2E smoke test (manual)
Requires full Docker stack running + Linphone configured.
1. `docker compose up -d`
2. Dial 1234 from Linphone (`sip:test-phone@<host>:5080`)
3. Expect: seed flow plays greeting audio, prompts for digit
4. Verify in `docker compose logs stasis -f`: StasisStart event, node executor logs, StasisEnd event
5. Hang up — confirm clean session teardown in logs
