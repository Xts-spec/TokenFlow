# WorkBuddy official SDK gateway

Both mainland China and international WorkBuddy inference now runs through the pinned official `@tencent-ai/agent-sdk` (0.3.276). The sidecar still owns login, account discovery, model catalogs and quota queries. It no longer handles WorkBuddy model generation on the exported gateway.

Each request resolves the selected account, reads its server-side credential, chooses the corresponding SDK region, and explicitly selects the requested model. A mismatched returned model is rejected. No alternate account or model is silently substituted. No fixed client identity introduction is inserted into or substituted for the conversation.

The client retains conversation history and executes tools. The SDK receives the transcript plus only caller-provided MCP tool definitions, with built-in filesystem and shell tools disabled. Tool requests are returned to Codex/Claude Code; their actual results arrive on the next gateway request. SDK session/config directories are temporary, isolated per request, and removed after the owned CLI process exits. Long requests send SSE keep-alive comments before the final protocol events.

SDK input token totals already include cache reads and writes. Responses and Chat Completions retain this inclusive total; Anthropic Messages receives disjoint input/cache fields. The existing gateway ledger records the selected account and API Key exactly once. Official quota balances remain separately queried from the provider.

The SDK and its Zod 4 dependency live in a separate workspace so the application's Zod 3 contracts are unchanged. The packaged runtime invokes its bundled CLI with the application's Electron Node runtime; installing a separate Node or CodeBuddy CLI is not required.

## Compatibility and identity review (2026-10-14)

- The shared Cursor/WorkBuddy input parser permits up to 2048 tool definitions, replacing the former 256 limit. Gateway request bodies remain bounded at 16 MiB. Neither bound is an authorization rule; they limit local resource use, and do not guarantee that every upstream model can accept the same catalog.
- WorkBuddy flattens namespace declarations, preserves names when returning calls, and accepts Responses Lite additional tool declarations. JSON Schema unions or unsupported conversion keywords fall back to a permissive object schema with the original schema in the tool description. Client-side validation still matters: the fallback does not enforce every constraint. The gateway proposes tools; it does not execute caller tools locally.
- Cursor passes JSON Schema directly to its SDK rather than converting through Zod. Large flat catalogs and union-schema preservation have regression coverage. Its parser still rejects unsupported input variants, including namespace catalogs and some image/output-format features; these require specific protocol adapters, not removal of authorization checks. Other sidecar providers do not use this shared parser and retain their own limits.
- WorkBuddy errors now distinguish credential resolution, local directory setup, SDK invocation, and output validation. SDK invocation can include both CLI startup and upstream failure; this code does not claim to distinguish those without additional evidence. Returned errors exclude raw exceptions, tokens, and local paths. Invalid input is rejected before opening a successful-looking stream.
- WorkBuddy's gateway adapter preserves supplied identity instructions, uses the selected account and region, and does not inject client-identifying HTTP headers. The official SDK owns its own CLI/network identity. This is **not** a claim that the entire gateway is an identity-preserving HTTP proxy.
- The bundled sidecar's Codex OAuth executor supplies a `codex-tui` User-Agent and Originator defaults, with header-specific forwarding/override rules. Its optional `codex.identity-confuse` feature rewrites identifiers when enabled; the app's generated configuration does not enable it. The Claude OAuth executor includes Claude Code fingerprint/cloaking behavior, conditionally injecting identity information for non-Claude-Code callers. The app does not globally disable that behavior. See `codex_executor_request.go` and `claude_executor_cloaking.go` under `upstream/CLIProxyAPI/internal/runtime/executor`.
- Direct API-source relays use an explicit protocol-header allowlist and the selected source's credential. They do not forward arbitrary incoming client headers. Account isolation, credential scope, upstream channel denials, and disabled local SDK tools remain enforced.

This review and the configuration-only restore changes do not modify upstream fingerprint/cloaking policies. A provider-by-provider identity policy change needs separate compatibility work; permissive schema conversion is unrelated to bypassing an upstream channel restriction.

## Verification on 2026-10-13

Real `workbuddy/deepseek-v4.1-flash` requests succeeded with both regional accounts through Codex and Claude Code. Each client read/edited temporary project files, ran tests, compacted context, restarted its client and the gateway, resumed the same conversation, then made and tested a second change. The international Codex test used the Codex engine bundled with the installed desktop app. These were isolated native client sessions, not an automated test of the protected desktop composer.

- China: Codex 9 requests / 5 tool-result requests; Claude Code 13 / 5.
- International: Codex 5 requests / 3 tool-result requests; Claude Code 9 / 3.
- No 11128 channel rejection in those successful runs.
- Deterministic integration checks cover both account pins, all three gateway protocols, streaming/non-streaming token accounting, and disabled-account rejection.

Live scripts require explicit `--live`. Saved report files contain counts and test metadata; credentials are removed during cleanup. See `scripts/agent-task-live.ts` and `scripts/workbuddy-sdk-gateway-live.ts`.


## Failure recovery verified on 2026-10-15

The pinned SDK can throw `ExecutionError` instead of yielding a result. The adapter now handles both channels and preserves already-proposed deferred tools on `error_max_turns`. A real long-history run reproduced an unhandled `Transport not started` rejection after a late MCP callback: control replies are now dropped only when their own transport is already closed. Errors on a live transport remain visible.

Cancellation explicitly closes that query's transport; aborting only the signal left silent streams waiting for another SDK event. Owned CLI cleanup retains a bounded fallback and never kills unrelated processes. Eight concurrent real SDK cancellation probes closed within 264 ms; the packaged runtime cancellation probe completed in 509 ms.

HY4 passed 48/48 requests with 12 workers, 80 historical tool rounds and four new tool rounds, following a separate 12/12 run. A later 24-worker reproduction identified one concrete `error_during_execution` path: the CLI labels `Max turns (1) exceeded` with that subtype. The original 54.5-second instance did not retain its message, so its exact cause cannot be proven retroactively. GLM/Kimi account quota failures remain real upstream limits. These results do not establish that every SDK failure is fixed. Reports and remaining work are indexed in [repair progress](../archive/reports/repair-progress-2026-10-15.md).


## Completed tool turns and startup cancellation (2026-10-15, build 10.15.26.5)

With 24 workers, 100 historical tool rounds and up to four new tool rounds, the pre-fix run reproduced three mislabeled turn-limit errors and three 240-second timeouts. All three timeouts already had tool proposals at approximately 26, 11 and 61 seconds. The SDK continued its own inference after deferring tools to the client, despite `maxTurns: 1`.

The adapter now finishes at the complete native `message_stop` of a tool turn. It validates every tool block, name, argument schema, model and sequential/parallel constraint before handing proposals to the client. Truncated/refused turns, invalid blocks and stream errors fail. All parallel proposals are retained, callbacks are deduplicated, and late callbacks cannot mutate the result. Native usage is preserved when the SDK follows its real usage delta with a synthetic zero-usage end marker. Caller tools still execute only in the caller. The narrow turn-limit fallback recognizes the exact known message only when all reported errors match; unrelated exceptions are not swallowed.

The pinned SDK also starts its CLI after asynchronous version discovery without rechecking whether its transport closed. A real SDK cancellation probe reproduced eight starts after cancellation and 13–17 second cleanup. The adapter rejects already-aborted input and guards the request's own delayed `start`. After the fix, 16/16 cancellation probes completed within 258 ms with no child resurrected or left running.

After the tool-turn fix, the real international HY4 run completed 84 of 92 requests; seven returned real exhausted-credit errors, and one timed out without a complete first tool response. All 84 successful requests used the new tool handoff. That final timeout reached a thinking block around 28 seconds; the probe did not retain thinking-delta timestamps, so it cannot establish whether the upstream was continuously thinking or stalled. No retry or alternative account was silently substituted. Different fixed regional accounts were used for the two runs, so these are not controlled latency A/B measurements.

Offline replay uses the real pinned SDK and real child-process pipes with a synthetic CLI: 96/96 long-history tool requests completed despite the fixture staying silent after its tool turn. A further run cancelled 24 thinking-only requests and completed the following 96 tool requests (120/120 checks); all owned children exited. These are protocol and lifecycle tests, not 120 upstream inferences. The focused suite passed 70 tests. See the repair progress report for evidence and packaged verification.


## First-thinking idle recovery (2026-10-15, build 10.15.26.6)

The same failure was reproduced with the authorized international `deepseek-v4.1-flash` account at 24 workers × 100 historical tool rounds × up to four new rounds: 92/93 completed, one timed out. The failing request opened exactly one `/v2/chat/completions` HTTP request (200 at ~25 seconds). It emitted 124 thinking deltas, the last at 27.476 seconds, then no model progress until cancellation at 240 seconds. There was no second model HTTP attempt. Its CLI event-loop lag after 30 seconds was at most 97 ms. This rules out an SDK retry loop, local startup queue, and sustained local event-loop blockage as the cause of this reproduced stall; it does not reveal the provider's internal reason for not finishing the stream.

The pinned CLI defaults both first-token and stream-idle thresholds to 1,200,000 ms, while the gateway has a 240,000 ms total deadline. Thus a stalled first thinking turn could never reach SDK idle recovery before the gateway cancelled it. The adapter now arms a 60-second model-progress watchdog once a model turn starts. Nonempty thinking, text or tool-argument deltas reset it; status events, empty deltas and keepalives do not. It does not impose a 60-second total thinking budget: a continuously progressing model may continue within the existing total request deadline.

After a silent first turn, the adapter closes and fully cleans up its own CLI before making **at most one** new attempt with the identical account, model, history and caller signal. Only a turn with no text and no tool proposal can retry. Text output, even an incomplete tool block, caller cancellation, and ordinary upstream errors forbid replay. Both attempts share the original 240-second deadline. If recovery also stalls, the gateway returns an explicit timeout without leaking the SDK exception. No background retry remains after the request ends. A retry is a new upstream inference; a failed attempt with no usage cannot be reconstructed as an exact billed token count, and the provider quota remains authoritative.

Verification:

- Two 24-worker real runs after the change completed 96/96 each, 192/192 total. The repeated run also captured normal bounded retries after pre-header `ECONNRESET` on other requests; those completed. These are distinct from the naturally stalled first-thinking request, which had no model retry.
- Real SDK + synthetic CLI replay stalled the first attempt of all 24 workers, with ongoing CLI keepalives. Each retried exactly once and completed four tool rounds: 96/96 requests, 120 owned CLI children, all exited (slowest request ~61.4 seconds).
- In a separate isolated live fault test, only the first model response was locally held after synthetic thinking. The real SDK closed it after 60 seconds without model progress, then a second actual Flash invocation completed. The affected request finished in 76.6 seconds and its following tool round also passed (2/2). The fault was injected, not an additional natural upstream failure.
- The focused regression suite passed 78 tests, covering one-retry limits, same-input identity, active thinking, keepalive-only traffic, caller cancellation, no replay after text/tool output, and timeout reporting.
- `step-5-preview` was not advertised in this international account's returned 23-model catalog; it was not substituted silently or counted as tested.

Network probes are opt-in synthetic-test tooling. They record endpoint hashes, statuses, counters and timings, not credentials, payloads or thinking text. The injection and network preload are not included in the app's production request path.


## Account endpoint correction (2026-10-15, after V10.15.26.6)

A fresh comparison reproduced a distinct pre-inference failure: the international default selected `www.codebuddy.ai`, whose TLS connection failed on this machine. The same WorkBuddy account succeeded when the direct CLI received `--settings '{"endpoint":"https://www.workbuddy.ai"}'`. Four concurrent processes each consumed 100 synthetic historical tool rounds and executed two disposable Read operations before returning both results (4/4, 13.8–18.6 s).

The gateway now preserves the verified WorkBuddy account domain through credential resolution and SDK initialization (`endpoint`), instead of relying only on the international region. Only the already allowlisted `www.workbuddy.ai` credential domain receives this override; other accounts keep their existing endpoint behavior. No account/model substitution or certificate-validation bypass occurs. Direct CLI does not intrinsically fix the first-thinking stall: the SDK itself wraps the CLI, and the gateway's bounded idle recovery remains necessary.

Reproduction: `node scripts/workbuddy-direct-cli-probe.mjs --live`. The opt-in probe uses temporary files/config, sends synthetic history only, and prints sanitized results.

After the endpoint fix, the live gateway completed 96/96 requests with 24 workers, 100 historical tool rounds and four new tool rounds per worker. The packaged runtime additionally passed 96/96 synthetic tool handoffs with all 96 child processes exited. Focused runtime/provider tests passed 56/56.
