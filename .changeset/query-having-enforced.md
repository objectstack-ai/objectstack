---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/metadata-protocol": minor
---

feat(objectql)!: `query.having` is enforced — the engine applies it after aggregation (#4286 step 3, ADR-0049 resolved to enforce)

`having` had been declared on the request surface since AST v2 and executed by
nothing. #4286 finding 1 showed the gap was structural: `engine.aggregate()`
rebuilt the driver AST with exactly `object`/`where`/`groupBy`/`aggregations`,
so even a driver that *did* implement HAVING could never have received it, and
the one wire path (`findData`'s aggregate branch) dropped the clause too. It
was the strongest enforce candidate of the #4286 set — the clause every
SQL-literate author (human or model) expects to work next to
`groupBy`/`aggregations` — and it is now live end to end:

- **Engine-owned, both paths.** `applyHaving()`
  (`packages/objectql/src/having-filter.ts`) runs AFTER aggregation on the
  native-driver path and the in-memory fallback alike — the same
  correct-first / optimize-later two-tier shape date bucketing uses. Native
  SQL `HAVING` pushdown can come later behind a driver capability flag without
  changing semantics.
- **Namespace: the aggregated row's own columns** — aggregation aliases
  (`order_count`, `total`) and groupBy projections — with the ordinary
  FilterCondition operators plus `$and`/`$or`/`$not`.
- **An unknown operator rejects loudly.** Ignoring one (as tolerant matchers
  do) would silently return unfiltered aggregates — the exact ADR-0078
  silently-inert failure enforcement exists to end.
- **The wire path forwards it.** `findData`'s aggregate branch passes
  `having` through, and `EngineAggregateOptionsSchema` now declares it.
- The FLS predicate guard already walked `having` references
  (`predicate-guard.ts`), which is what made enforcement safe to turn on.

No migration needed: queries that carried `having` before were silently
returning every group; they now filter as written. A caller who depended on
the clause being *ignored* (sending `having` and expecting unfiltered
results) sees the corrected behavior — that is the enforcement, not a
regression.
