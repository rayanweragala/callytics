# Known Vulnerabilities

The following vulnerabilities are known, assessed, and intentionally deferred. Each has been evaluated for exploitability and fix feasibility.

## Stasis: ari-client chain (CRITICAL)

**Vulnerabilities:** `form-data` (critical), `cookiejar` (moderate), `qs` (moderate), `tough-cookie` (moderate) — all trace through `ari-client`'s dependency on `request` and `swagger-client@2.0.26`.

**Assessment:** `ari-client@2.x` was evaluated as a fix candidate. It was rejected because `v2.2.0` retains the same `request` + `swagger-client@2.0.26` dependency chain and does not resolve the critical `form-data` vulnerability. The real fix requires replacing `ari-client` entirely with a direct ARI WebSocket client — a major architectural effort tracked as a future phase.

**Exploitability:** Low in practice. `ari-client` is an internal service-to-service library used only inside the Docker network to communicate with Asterisk ARI. It is never exposed to the public internet or user input.

## Frontend: @typescript-eslint chain

**Vulnerabilities:** `minimatch` ReDoS (high) — traces through `@typescript-eslint/typescript-estree` v6.

**Assessment:** Fix requires upgrading to `@typescript-eslint` v8, which introduces 291 lint errors across the frontend codebase due to stricter rules. Deferred until a dedicated lint cleanup phase.

**Exploitability:** None in production. `@typescript-eslint` is a `devDependency` — it is never present in the production Docker image or browser bundle.

## Fixed in Phase 46-4

- Backend: NestJS upgraded from v10 to v11 (multiple moderate CVEs resolved)
- Backend: `multer` upgraded to v2.1.1 (3 high DoS CVEs resolved)
- Frontend: `axios` upgraded to v1.16.1 (13 CVEs resolved including prototype pollution, header injection, SSRF)
- Frontend: `vite` upgraded to v8.0.13 (esbuild moderate CVE resolved)
- Stasis: `lodash` patched (prototype pollution CVEs resolved)
- Backend: dual-rxjs TypeScript conflict resolved via `tsconfig.json` paths mapping
