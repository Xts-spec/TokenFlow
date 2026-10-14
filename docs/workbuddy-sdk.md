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
