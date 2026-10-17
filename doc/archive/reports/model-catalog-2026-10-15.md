> 历史记录：保留当时的结论与验证范围；当前待办以 [TODO](../../TODO.md) 为准，产品行为以当前源码和 [使用指南](../../guides/usage.md) 为准。

# Account model discovery and Antigravity correction

The application polls account/model state after startup and approximately every 30 seconds after completion of the previous refresh. Official per-account catalog requests have a 30-second cache. The provider refresh action forces a new catalog query; quotas refresh after five minutes when the next account poll sees stale quota, or manually. These are not a new vendor request per UI render. Unverified static tables are no longer published as account permissions. Failed refreshes retain verified catalogs for at most 15 minutes, with an explicit stale status. Successful discovery is not proof of remaining quota or future inference success.

## Reproduced problem

For two saved Antigravity accounts, the production catalog returned `gemini-pro-agent`, while the daily catalog did not. The executor sends inference to daily by default, but discovery previously fetched production. The actual request returned 404. Discovery also omitted the account project, could expose the historical static table on initial failure, and the desktop's global-registry merge could reintroduce routes absent from freshly discovered accounts.

## Fix

- Fetch from the same daily/default endpoint as inference and include the account project; respect explicit endpoint overrides.
- Remove models explicitly named by `deprecatedModelIds`; do not infer retirement from an ID's version or one HTTP 500.
- For all authorized providers, publish no unverified static list on initial failure. On transient failure retain the last verified list for at most 15 minutes with an explicit status.
- Include project and account domain in the discovery cache identity.
- Do not reintroduce global routes absent from all successfully discovered active account catalogs.

Regression tests reproduced missing project, obsolete fallback and stale global-route publication before the fix. Go official-catalog tests and 25 desktop account/login tests passed after it. Live discovery changed from 26 to 17 namespaced models for the tested account, removing nine IDs absent from the inference endpoint, including `gemini-pro-agent`. That model is now rejected locally as unavailable instead of advertised and forwarded to a 404.

`gemini-2.5-flash` returned `ok` before and after the correction. The reported HTTP 500 has now been traced to pre-header EOF and reproduced with TCP fault injection; bounded reconnection passed 96/96 real-inference tool requests. Its live advertised display name is Gemini 3.5 Flash Lite; the old-looking ID alone is not grounds for removal. Opus and Sonnet returned explicit account quota exhaustion (429) during this run. Model availability and quota are separate states; the fix does not claim unlimited availability.

Detailed follow-up: [Antigravity EOF and account catalog verification](antigravity-500-repair-2026-10-15.md).

Follow-up picker correction: the 17 public entries still included auxiliary/compatibility models. The final catalog intersects live `agentModelSorts[].groups[].modelIds`, producing six selectable conversation models for each tested account. It never merges command, completion, or image-only lists.

2026-10-16 follow-up: WorkBuddy official config endpoint and early SDK identity corrected; native Trae catalog/inference and ZCode conversation scope added. The conflated Doubao/MarsCode adapter has been removed at the user’s request. See [current evidence and limitations](model-catalog-followup-2026-10-16.md).
