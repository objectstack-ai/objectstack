---
"@objectstack/spec": minor
---

feat(spec): retire `MetricSchema.filters` — the per-metric raw-SQL filter nothing read (#10414, ADR-0049)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`filters` on a cube metric (`filters: [{ sql: string }]`) was a real authoring
surface — `defineCube()` parses an author literal and
`defineStack({ analyticsCubes })` carries every cube through `StackSchema.parse`
— with ZERO consumers, measured with a positive control: no `.filters` read in
`service-analytics` or any driver's non-test code, while the neighbouring
`format` key IS read. `NativeSQLStrategy.resolveMeasureSql` and
`ObjectQLStrategy.resolveMeasureAggregation` both wrap the metric's `sql` in
the aggregate and never look at `filters` — so a hand-authored
`filters: [{ sql: "stage = 'closed_won'" }]` parsed, registered, and silently
returned the UNFILTERED aggregate under the author's metric name. That is the
#10298 dataset-measure failure for a hand-authored cube; the dataset half was
repaired through its own structured channel (#10411), which left this key inert
with the fix built around it. The raw-SQL fragment also ran against the
platform's structured-`FilterCondition` direction: it cannot be parameterized,
re-targeted per driver dialect, or walked by the lint filter rules
(`packages/lint/src/filter-walk.ts` deliberately never enumerated it).

**What is refused:** `filters` on a metric. `MetricSchema` is `strictObject`,
so the key is deleted from the shape and the unknown-key rejection carries the
retirement prescription via the schema's `guidance` entry (fully-qualified key,
why it was inert, the replacement channels, the `os migrate meta` pointer).
The nested `strictObject` the key carried (closed by #4001 batch D) is gone
with it.

**What stays accepted:** every other metric key (`name`, `label`,
`description`, `type`, `sql`, `format`) parses byte-identically. Filtering
that actually works is unchanged: the query's `where` (canonical Query DSL
`FilterCondition`), the condition folded into the metric's own `sql`
expression, or an ADR-0021 dataset measure's structured `filter`.

The retirement kit:

- strict deletion + `guidance` prescription at the schema
  (`packages/spec/src/data/analytics.zod.ts`); the `AnalyticsQuerySchema`
  `filters` guidance no longer points authors at the removed key
- ADR-0087 registration: retired-key entry `data/Metric:filters` and the D2
  conversion `metric-filters-removed` (protocol 18), wired into the step-18
  chain — `os migrate meta --from 17` strips the key from every metric in
  `analyticsCubes[].measures` (pure lossless delete; it never had an effect to
  lose)
- pin tests (`analytics.test.ts` — the old parse-survival pin flips to a
  refusal pin asserting the prescription; `analytics-strictness-batchd.test.ts`
  records the nested batch-D surface as superseded)
- generated baselines/docs follow the schema (`authorable-surface/`,
  spec-changes, upgrade guide, reference docs)

## FROM → TO

```ts
// before — parsed green; both SQL strategies ignored it and the query
// returned the unfiltered aggregate
defineCube({
  name: 'orders',
  sql: 'orders',
  measures: {
    closed_won_revenue: {
      name: 'closed_won_revenue', label: 'Closed-Won Revenue',
      type: 'sum', sql: 'amount',
      filters: [{ sql: "stage = 'closed_won'" }],
    },
  },
  dimensions: {},
});

// after — delete the key; express the condition where something reads it:
//   query time:      { where: { stage: 'closed_won' } }
//   in the metric:   { type: 'sum', sql: "CASE WHEN stage = 'closed_won' THEN amount END" }
//   dataset measure: a structured `filter` (ADR-0021, the #10411 channel)
```

<!-- adr-0087: registered metric-filters-removed -->
