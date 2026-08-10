---
'@objectstack/runtime': patch
---

`GET /api/v1/automation/:name/runs` now refuses a malformed query parameter with a
proper ADR-0112 refusal (`400`, `error.code: VALIDATION_FAILED`, `details.fields[]`
naming the parameter with an ADR-0114 field code) instead of coercing it into a
value nobody asked for — the same gate `GET /api/v1/notifications` grew in the
previous release, now shared between the two routes rather than copied.

Wire-visible for raw-HTTP callers only — the typed SDK's `limit` is a `number` and
its `cursor` a `string`, so neither could produce these:

- `?limit=abc` coerced to `NaN`, which nothing downstream catches: the automation
  engine's `options?.limit ?? 20` does not catch NaN (`??` tests for null/undefined
  only) and its final `.slice(0, NaN)` is `[]`. So a typo in the window answered
  **200 with an empty run list** — "this flow has never run", stated confidently
  about a flow with runs. Non-integers (`1.5`, `Infinity`, `10abc`, a repeated
  `?limit=1&limit=2`) are refused on the same rule.
- `cursor` was forwarded raw into a slot the contract types `cursor?: string`
  (`IAutomationService.listRuns`), so a repeated `?cursor=a&cursor=b` handed an
  array to a service that had declared it would receive a string. The shipped
  engine ignores the option entirely today, which is why the boundary is the right
  place to close it: the first implementation that starts honouring cursors must
  not be the one that discovers the type was never enforced.

Unchanged on purpose: every value that already had a defensible answer keeps it,
byte for byte — out-of-range numbers (`?limit=1000`, `?limit=-5`) still reach the
engine untouched, because range is its declared business (`ListRunsRequestSchema`
bounds it and the engine slices by it), absent/empty parameters still mean "no
limit", any string cursor still passes through verbatim, and unknown query keys are
still ignored rather than refused.
