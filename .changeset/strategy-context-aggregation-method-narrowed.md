---
"@objectstack/spec": minor
"@objectstack/service-analytics": patch
---

fix(spec): `StrategyContext.executeAggregate` `aggregations[].method` narrows from `string` to `AggregationFunction` (#12776)

<!-- adr-0087: registered strategy-context-aggregation-method-narrowed -->

**BREAKING** accept-set narrowing on a published contract, landing after the
v17.0.0 cut (the lockstep launch-window convention ships it as `minor`).

Two spec-declared surfaces described the same slot and disagreed about its
type: `IDataEngine.aggregate`'s `aggregations[].function` is the closed
six-value `AggregationFunction` enum, while the analytics strategy contract's
`StrategyContext.executeAggregate` declared the same value as
`aggregations[].method: string`. The analytics bridge renames one to the
other, so nothing on the analytics side of that seam was compile-checked
against the engine's vocabulary — a strategy author (very often an AI) got
no compile-time help and hit the bridge's runtime refusal instead.

FROM → TO:

- `aggregations[].method: string` →
  `aggregations[].method: AggregationFunction`
  (`'count' | 'sum' | 'avg' | 'min' | 'max' | 'count_distinct'`, the spec's
  own enum from `@objectstack/spec/data`). One slot, one declaration.

Who breaks at compile time on upgrade:

- external CALLERS of `StrategyContext.executeAggregate` that fill `method`
  with a value typed `string` (or a literal outside the six) — the values the
  bridge already refused at runtime (#11833) now fail `tsc`.
- external IMPLEMENTORS of `StrategyContext` stay source-compatible: a
  handler that accepts `method: string` accepts a superset and remains
  assignable to the narrowed member.

The bridge's runtime parse-and-refuse (#11833) stays as defence in depth.
In-repo, `ObjectQLStrategy`'s aggregation locals now carry the enum
end-to-end (`@objectstack/service-analytics`, runtime behaviour unchanged —
the census measured every reachable producer already emitting enum-legal
values only).
