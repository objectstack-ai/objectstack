---
"@objectstack/service-analytics": patch
---

fix(service-analytics): a fail-closed row-scope refusal can no longer be served as an empty chart (#17130)

`queryDataset` degrades to `{rows: [], fields: [], totals: []}` when a BARE error looks like a driver reporting an absent table — a deliberate leniency (#5033) so a dashboard widget over an unmounted object renders "no data" instead of failing. The test is a substring match over the message, and three of its six limbs — `not registered`, `unknown object`, `is not a registered object` — are exactly the phrasings a registry or security refusal reaches for.

Both sites of the row-scope RESOLUTION stage refused with a bare `throw new Error(…)`: the `security` bridge in `AnalyticsServicePlugin`, and `AnalyticsService.resolveReadScopes`. They propagated only because their wording happened to miss all six — so any reword, or any refusal added to that stage later, could silently turn a fail-closed gate into a `200` with no rows.

Both now declare `READ_SCOPE_COMPILE_FAILED` / `500` — the code the sibling read-scope LOWERING stage has answered with since #5367, so the registered wire vocabulary is unchanged. Two visible consequences for a deployment whose wired `security` service cannot answer a row-level read scope:

- the refusal reaches the caller as a declared `500` instead of relying on its phrasing to escape the degradation path;
- its message is withheld from the response body by declaration (the operator still gets the full text, at `error`, from the producing site) rather than echoed.

Every refusal message is byte-unchanged, and #5033's leniency is untouched: a genuine absent source table still degrades to the empty result with its `warn`, and a deployment with NO security service still runs unscoped exactly as before. A guard derived from the source (`refusal-wording-collision.test.ts`) now walks every `throw` in the package and fails if an un-enveloped refusal can be read as a missing source table.
