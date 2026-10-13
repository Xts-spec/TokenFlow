# WorkBuddy official SDK gateway

Both mainland China and international WorkBuddy inference now runs through the pinned official `@tencent-ai/agent-sdk` (0.3.276). The sidecar still owns login, account discovery, model catalogs and quota queries. It no longer handles WorkBuddy model generation on the exported gateway.

Each request resolves the selected account, reads its server-side credential, chooses the corresponding SDK region, and explicitly selects the requested model. A mismatched returned model is rejected. No alternate account or model is silently substituted. No fixed client identity introduction is inserted into or substituted for the conversation.

The client retains conversation history and executes tools. The SDK receives the transcript plus only caller-provided MCP tool definitions, with built-in filesystem and shell tools disabled. Tool requests are returned to Codex/Claude Code; their actual results arrive on the next gateway request. SDK session/config directories are temporary, isolated per request, and removed after the owned CLI process exits. Long requests send SSE keep-alive comments before the final protocol events.

SDK input token totals already include cache reads and writes. Responses and Chat Completions retain this inclusive total; Anthropic Messages receives disjoint input/cache fields. The existing gateway ledger records the selected account and API Key exactly once. Official quota balances remain separately queried from the provider.

The SDK and its Zod 4 dependency live in a separate workspace so the application's Zod 3 contracts are unchanged. The packaged runtime invokes its bundled CLI with the application's Electron Node runtime; installing a separate Node or CodeBuddy CLI is not required.

## Verification on 2026-10-13

Real `workbuddy/deepseek-v4.1-flash` requests succeeded with both regional accounts through Codex and Claude Code. Each client read/edited temporary project files, ran tests, compacted context, restarted its client and the gateway, resumed the same conversation, then made and tested a second change. The international Codex test used the Codex engine bundled with the installed desktop app. These were isolated native client sessions, not an automated test of the protected desktop composer.

- China: Codex 9 requests / 5 tool-result requests; Claude Code 13 / 5.
- International: Codex 5 requests / 3 tool-result requests; Claude Code 9 / 3.
- No 11128 channel rejection in those successful runs.
- Deterministic integration checks cover both account pins, all three gateway protocols, streaming/non-streaming token accounting, and disabled-account rejection.

Live scripts require explicit `--live`. Saved report files contain counts and test metadata; credentials are removed during cleanup. See `scripts/agent-task-live.ts` and `scripts/workbuddy-sdk-gateway-live.ts`.
