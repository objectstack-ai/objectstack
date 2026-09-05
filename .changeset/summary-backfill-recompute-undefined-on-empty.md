---
"@objectstack/objectql": minor
"@objectstack/cli": minor
---

feat(objectql,cli): `backfillSummaryNulls` accepts `recomputeUndefinedOnEmpty` — a caller who KNOWS a `min`/`max`/`avg` roll-up column was just declared can have it filled; `os migrate summary-nulls --recompute-undefined-on-empty object.field` surfaces it (#15064)

A roll-up value has three producers — the insert-time seed, the child-write
recompute, and the one-off backfill — and **declaring a summary field on an
object that already has rows reaches none of them**. For `count`/`sum` the
backfill repairs that as a side effect (every `NULL` is a hole to it). For
`min`/`max`/`avg` it could not: `summaryNullIsBackfillable` decides on the
function alone, so "never computed" and "no child rows" were indistinguishable,
the column stayed `NULL` on every pre-existing parent, and the report said
`filled: 0` — a false all-clear that a timed flow built on the column then
turned into "matches nothing" (the customer case behind cloud#1908).

**What changes** — maintainer ruling on #15064, option A: the caller who holds
the fact gets a way to say it; the predicate and the default run do not move.

- `SummaryBackfillOptions.recomputeUndefinedOnEmpty?: string[]` — `object.field`
  roll-ups the caller knows were never computed. A named `min`/`max`/`avg` is
  walked like a `count`: every `NULL` parent is recomputed through the same
  `aggregateSummaryValue` the engine writes. A parent whose aggregate is the
  empty-set reading (`null` — no child rows) already holds the engine's own
  value, so it is neither counted as a hole nor written; the scoped run is
  therefore idempotent in the same "re-run until it reports zero" sense.
  Naming a `count`/`sum` is accepted and changes nothing, so a publish path can
  pass every column it just declared without knowing the empty-set list.
- A name that resolves to no roll-up owned by an object the run walks — a typo,
  a plain field, or an object `objects` left out — is **refused before any row
  is read**, dry run or apply, with an ADR-0112 envelope (`code:
  'INVALID_FIELD'`, `status: 400` — the code every other axis that names a
  field already answers; `field` names the first unresolved entry, `fields`
  all of them). A silent no-op there would be the same false all-clear this
  option exists to end.
- `SummaryBackfillReport.recomputedUndefinedOnEmpty: string[]` — the complement
  of `skippedUndefinedOnEmpty`, same `object.field (fn)` spelling; `[]` on an
  unscoped run. `SummaryBackfillFieldOutcome.fn` widens from `'count' | 'sum'`
  to every roll-up function, since a named `max` now appears in `fields`.
- `os migrate summary-nulls --recompute-undefined-on-empty object.field`
  (repeatable) passes the scope through; the confirmation prompt names the
  columns; `formatSummaryBackfillReport` lists them under "Recomputed on
  request" and explains a `NULL` that remains.

**What does not change:** without the option the walk, the writes, every
counter and the human-readable report are byte-for-byte what they were (pinned
against output captured on `main` before this change); `min`/`max`/`avg` stay
out of scope and keep being reported under `skippedUndefinedOnEmpty`; the
predicate `summaryNullIsBackfillable` is untouched, so `os migrate
summary-nulls` keeps its meaning on every deployment. The only visible delta on
an unscoped run is the one additive report key, `recomputedUndefinedOnEmpty: []`.

`minor` for both packages: an optional parameter on a published exported
function, a new report key, and a new CLI flag are each a purely additive
widening of a published surface, which takes at least `minor` (bump-level rule,
2026-09-04); the `fix`-shaped motivation does not lower it.
