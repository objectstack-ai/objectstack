---
"@objectstack/spec": minor
---

feat(spec): the relative-token axis completes the temporal conformance matrix (ADR-0053 D-A3.2)

`@objectstack/spec/data` gains `TEMPORAL_TOKEN_CASES` and `TEMPORAL_TOKEN_NOW`,
the last axis ADR-0053 D-A3 asked for. Where `TEMPORAL_CASES` takes already-
resolved comparands, these carry the filter **as authored** — placeholders
intact, `{ at: { $lte: '{today}' } }` — plus a pinned reference instant, and
each consumer resolves them through `resolveFilterTokens` exactly as the
ObjectQL engine does before calling a driver.

That asserts a property neither half could alone. `{today}` resolving to the
right calendar day is covered in core; a bare day as an upper bound meaning the
whole day is covered by the resolved-comparand cases. The **composition** was
never asserted — and the composition is the filter the default dashboard emits,
the one #3777 was reported against. `{current_month_end}` is included for the
same reason: the issue named it as the case where an author's "last day of the
month" intent had no layer translating it.

Run by the four backends downstream of resolution: `driver-sql` (and, through
the live-dialect CI job, real Postgres and MySQL), `driver-memory`,
`driver-mongodb` against a real MongoDB, and the analytics preview evaluator.
`formula`'s `matchesFilterCondition` is excluded on architecture rather than
coverage — an RLS `check` is CEL, where a relative date is the function
`today()` evaluated at compile time, so a `{token}` string cannot reach it.
