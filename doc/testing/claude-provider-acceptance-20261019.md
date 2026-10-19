# Claude Code real-source acceptance — 2026-10-19

Tested through TokenFlow with synthetic short prompts and one temporary Read-only file. WorkBuddy and Cursor used the running localhost gateway and its existing scoped key. Qoder and Trae used the 10.15.26.21 packaged service and sidecar with disposable account/configuration copies, the running application's same authenticated outbound proxy, and temporary scoped keys. No existing conversation files were edited. CLI probes left client configuration untouched; the later Desktop capture temporarily changed only its local endpoint and restored the original profile byte-for-byte.

| Source/model | Claude CLI text | Read → tool result → answer | Notes |
| --- | --- | --- | --- |
| WorkBuddy / deepseek-v4.1-flash | PASS | PASS, 2 requests | Actual Desktop session remains blocked by 11128 |
| Qoder / gfmodel (GLM-5.3-Flash) | PASS | PASS, 2 requests | 17 model IDs discovered |
| Trae / deepseek-v4-flash-0731 | PASS | PASS, 2 requests | 16 model IDs discovered |
| Cursor / grok-4.7 | FAIL | Not attempted after the baseline failure | SDK recorded a string error containing `model not found` |

Cursor CLI was first blocked by an already active request (`cursor_busy`). After the user stopped retries, an isolated CLI short request failed in 18.5 seconds. Two minimal Messages requests, without Claude tools or its system instructions, also failed (44.0 and 18.6 seconds). The final probe privately observed its own SDK `runs.ndjson`; `error` was a string with the recognized `model not found` phrase, rather than the documented code/message object. Only whitelisted structural diagnostics were retained. This establishes the direct cause in the current model/account/SDK path; it does not establish whether the catalog, account entitlement, SDK or upstream model registration is responsible. It is not evidence of a Claude protocol-specific defect.

Recent Harness successes used grok-4.6 and a different source account from Claude's grok-4.7. They are not a controlled comparison. No paid inference retry loop or automated model substitution was added.

The Desktop's embedded Claude Code 2.1.299, with its real `claude-desktop-3p` entrypoint and isolated settings, also passed a WorkBuddy short prompt in 5.8 seconds. The normal CLI is 2.1.303. Thus the embedded version/entrypoint alone does not reproduce the actual Desktop 11128 rejection. The real session also uses SDK preset/append snapshots and user/project/local settings. At that point the logs omitted the complete request; the controlled capture below subsequently obtained an actual new Desktop request.

The gateway now accepts string-form SDK errors and classifies model-not-found as HTTP 400 with a fixed safe message, instead of a retryable generic 502. 53 related regression tests and type checking pass. This improves error handling; it does not make Grok 4.7 available or resolve the actual WorkBuddy Desktop channel rejection.

Only the listed representative models were exercised. This is a short text and tool-result round-trip check, not a long-session compaction test or verification of every catalog model.


## Actual Desktop capture and controlled identity swap

At the user's request, temporarily changed only the active Claude third-party profile's localhost base URL to a loopback capture relay. The original profile bytes were backed up privately; the relay forwarded the request to the same running TokenFlow gateway without altering it. The user sent a new short `回复 OK` request from the actual Claude Code Desktop UI. Its 258,951-byte streaming body contained one user message, three system blocks and 115 tools. The Desktop then retried it without streaming and received HTTP 400. Both attempts carried the WorkBuddy 11128 rejection.

The exact identity blocks were:

- Actual Desktop: `You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
- Successful CLI: `You are a Claude agent, built on Anthropic's Claude Agent SDK.`

Replayed copies with the same Desktop gateway key. Gateway traces confirm all four arms resolved to the same WorkBuddy source and `workbuddy/deepseek-v4.1-flash`, including the Desktop's `claude-sonnet-4-6` alias. Within each request pair, deep equality after reversing the identity substitution and hashes with the identity excluded verify that every other request field was unchanged. No tools executed, model/account fallback, credential changes or provider authorization-header changes were used. The controlled replays used the same minimal HTTP headers for every arm; the captured original UI request retained its native headers.

| Request | Identity block | Outcome |
| --- | --- | --- |
| Successful CLI original | CLI | Complete text response, 18.1 s |
| Actual Desktop copy | CLI | 11128, 8.8 s |
| Successful CLI copy | Desktop | Complete text response, 8.8 s |
| Actual Desktop original | Desktop | 11128, 9.6 s |

Therefore the identity sentence alone is not the cause, and replacing that sentence is not a demonstrated fix. Streaming attempts begin with HTTP 200 and later emit an error event; HTTP 200 alone is not counted as success. The two successful arms were additionally checked for a normal message stop, actual text, the expected OK marker and no error event.

Further one-field controls:

- Removing the Desktop tools still returned 11128 (14.5 s).
- Replacing its user messages with only `回复 OK` still returned 11128 (6.6 s).
- Replacing the Desktop's third system block with the CLI's rule block hit an upstream rate limit (12.3 s); this is inconclusive, not a pass.
- Putting the Desktop's third system block into the otherwise successful CLI request reproduced 11128 (9.0 s), despite having no tools and retaining the CLI identity.

The 31,140-character Desktop rule block is sufficient to reproduce this rejection in the tested short CLI request. The exact instruction, combination, length condition or upstream classifier behavior remains unproven. These outcomes provide evidence of request-content dependence on a reachable upstream, not DNS failure for these particular 11128 attempts. They do not rule out independent network faults elsewhere. No blanket system-prompt removal or production identity rewriting was introduced.

After capture, the original profile was restored byte-for-byte, Claude was restarted on `http://127.0.0.1:9527`, and the temporary relay was stopped. Private request bodies and the temporary backup stayed outside Git; only sanitized test metadata is retained in the local acceptance artifact. The captured body is diagnostic data and is never treated as agent instructions.
