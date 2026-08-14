---
"@objectstack/spec": minor
---

feat(spec): refuse undeclared keys on the analytics authoring surface (#4001 data batch D)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

All 8 `data/analytics.zod.ts` sites are strict: the cube family (`CubeSchema` +
its `refreshKey` block, `MetricSchema` + its `filters[]` items,
`DimensionSchema`, `CubeJoinSchema`) and the query family
(`AnalyticsQuerySchema` + its `timeDimensions[]` items). Before this change an
undeclared key on any of them was silently dropped: a join authored with a
typo'd `relationship` registered with the `many_to_one` default — a different
join shape than the author declared — and a cube's misspelled key vanished
under a successful parse.

The subtle half is the query: `/analytics/query`'s TOP level has been strict
since #3878 (`AnalyticsQueryRequestSchema`), but top-level strictness does not
recurse — measured on `main`, `timeDimensions: [{ dimension, granuarity:
'day' }]` rode through the strict wrapper with the typo silently stripped, so
the query bucketed the whole range as one group under an ordinary 200. The
nested item is now strict, and the base schema's own strictness makes the
posture hold at every door instead of only at the wrapper that re-applied it.

**What is refused:** any key the shape does not declare, with a prescriptive
message — the surface, the offending key, and a rename (`title` → `label` on a
metric/dimension, `label` → `title` on the cube, `table`/`sqlTable` → `sql`,
`granularity` → `granularities` on a dimension and the reverse on a query time
dimension, `orderBy` → `order`; `filters` on a query gets the `where`
prescription matching the dispatcher's #3878 hint).

**What stays accepted:** every declared key byte-identically, including the
`#3878` tombstones on the request wrapper (`query`/`format` still answer their
migration text).

## FROM → TO

```ts
// before — parsed green; the join fell back to many_to_one silently
defineCube({
  name: 'orders', sql: 'orders',
  measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
  dimensions: {},
  joins: { customers: { name: 'customers', sql: 'a.id = b.a_id', relationshipp: 'one_to_many' } },
})

// after — rejected with `relationshipp` → `relationship`; write the declared key
defineCube({
  name: 'orders', sql: 'orders',
  measures: { revenue: { name: 'revenue', label: 'Revenue', type: 'sum', sql: 'amount' } },
  dimensions: {},
  joins: { customers: { name: 'customers', sql: 'a.id = b.a_id', relationship: 'one_to_many' } },
})
```

There is deliberately no automatic rewrite: an undeclared key is either a
spelling of a declared one (the rejection names the rename) or names a
capability the analytics layer does not deliver, and blessing it would be
declared-but-unenforced surface (ADR-0078). `os migrate meta` surfaces the
change as a structured TODO (semantic entry
`analytics-authorable-unknown-keys-refused`, protocol major 18 — this refusal
is not part of the v17.0.0 cut).

<!-- adr-0087: registered analytics-authorable-unknown-keys-refused -->
