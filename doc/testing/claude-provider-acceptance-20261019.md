# Claude Code real-source acceptance — 2026-10-19

Tested through TokenFlow with synthetic short prompts and one temporary Read-only file. WorkBuddy and Cursor used the running localhost gateway and its existing scoped key. Qoder and Trae used the 10.15.26.21 packaged service and sidecar with disposable account/configuration copies, the running application's same authenticated outbound proxy, and temporary scoped keys. Original client configuration and conversation files were not modified.

| Source/model | Claude CLI text | Read → tool result → answer | Notes |
| --- | --- | --- | --- |
| WorkBuddy / deepseek-v4.1-flash | PASS | PASS, 2 requests | Actual Desktop session remains blocked by 11128 |
| Qoder / gfmodel (GLM-5.3-Flash) | PASS | PASS, 2 requests | 17 model IDs discovered |
| Trae / deepseek-v4-flash-0731 | PASS | PASS, 2 requests | 16 model IDs discovered |
| Cursor / grok-4.7 | FAIL | Not attempted after the baseline failure | SDK recorded a string error containing `model not found` |

Cursor CLI was first blocked by an already active request (`cursor_busy`). After the user stopped retries, an isolated CLI short request failed in 18.5 seconds. Two minimal Messages requests, without Claude tools or its system instructions, also failed (44.0 and 18.6 seconds). The final probe privately observed its own SDK `runs.ndjson`; `error` was a string with the recognized `model not found` phrase, rather than the documented code/message object. Only whitelisted structural diagnostics were retained. This establishes the direct cause in the current model/account/SDK path; it does not establish whether the catalog, account entitlement, SDK or upstream model registration is responsible. It is not evidence of a Claude protocol-specific defect.

Recent Harness successes used grok-4.6 and a different source account from Claude's grok-4.7. They are not a controlled comparison. No paid inference retry loop or automated model substitution was added.

The Desktop's embedded Claude Code 2.1.299, with its real `claude-desktop-3p` entrypoint and isolated settings, also passed a WorkBuddy short prompt in 5.8 seconds. The normal CLI is 2.1.303. Thus the embedded version/entrypoint alone does not reproduce the actual Desktop 11128 rejection. The real session also uses SDK preset/append snapshots and user/project/local settings; the available logs omit the complete request. No identity text was rewritten and no user append snapshot or old conversation was replayed.

The gateway now accepts string-form SDK errors and classifies model-not-found as HTTP 400 with a fixed safe message, instead of a retryable generic 502. 53 related regression tests and type checking pass. This improves error handling; it does not make Grok 4.7 available or resolve the actual WorkBuddy Desktop channel rejection.

Only the listed representative models were exercised. This is a short text and tool-result round-trip check, not a long-session compaction test or verification of every catalog model.
