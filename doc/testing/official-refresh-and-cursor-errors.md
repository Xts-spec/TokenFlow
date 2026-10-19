# Official refresh and Cursor error diagnostics — 2026-10-19

Account metadata reads use an initial attempt and at most two automatic retries, with 1 s / 2 s backoff. Transient quota HTTP/transport failures and stale/unavailable model catalogs qualify. Explicit HTTP authorization failures, rate limits and invalid payloads do not retry. The sidecar currently reports catalog lookup failures only as stale/unavailable, without preserving upstream status: these opaque results receive the requested two retries even if the unseen cause is authorization or rate limiting. Unsupported catalogs are not retried. This is a bounded refresh policy, not evidence that a catalog failure is a network problem. Catalog retries force a fresh lookup instead of repeatedly reading the same cached failure. Account credentials, selected models and successful cached balances are preserved. The UI suggests switching networks and refreshing after a failure. The brand status dot is removed; gateway failure notifications remain.

Cursor model discovery attempts the SDK once, then the official REST catalog at most twice. Cursor quota refresh includes transient failures in the unified weekly-balance endpoint; unavailable or withheld values are never converted to zero. These retries only read metadata, never generate or replay model responses.

Cursor SDK RunError retains code/message but not Error prototypes or HTTP status. The gateway now recognizes permission, quota, parameter, timeout and upstream internal/unavailable codes, and only classifies TLS/DNS failures when an explicit diagnostic exists. Messages are fixed, safe text; raw provider details are not returned.

## Evidence and limits

- Latest Claude Desktop → WorkBuddy new short requests at 14:40:14 and 14:40:21 also returned 11128. The same source/model succeeded from Claude CLI at 14:40:49. Old history length is not a necessary trigger; the exact Desktop request difference remains unproven. No identity text was replaced, and the WorkBuddy channel rejection is not fixed by this change.
- Cursor's retained compaction 422 entries were from 13:19–13:20, before the newest package. Later DeepSeek Harness activity alternated completed turns and failed new requests. No missing SSE terminator was reproduced. Historical generic 502 records lack the original SDK error code, so their cause cannot be recovered or claimed as DNS.
- No real model requests were generated for these tests; no user DNS, proxy, login or conversation configuration was changed.

## Regression checks

Run `npx vitest run tests/official-refresh.test.ts tests/quota-retry.test.ts tests/cliproxy-login.test.ts tests/cursor.test.ts tests/cursor-usage.test.ts tests/upstream-errors.test.ts`, then `npm run typecheck` and `npm run build`.

Manual acceptance: confirm a successful account refresh; temporarily break connectivity and confirm bounded retries plus the network hint; restore connectivity and refresh. Continue Claude Desktop/CLI and DeepSeek Harness conversations separately, recording the error category and timestamp if a model request fails. Metadata retry success is not proof that model inference works.
