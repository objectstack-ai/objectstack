---
"@objectstack/spec": minor
---

feat(spec): `ComponentPropsMap['element:number'].filter` converges onto the `ViewFilterRule` array form (#12039, objectui#6206 Option B)

<!-- adr-0087: registered element-number-filter-rule-array -->

**BREAKING** accept-set change on one props-map entry, shipped as `minor` under
the repo's launch-window convention for breaking changes; the migration
prescription is registered under protocol major 18.

One filter orthography platform-wide (maintainer batch adjudication
2026-08-25, verbatim 「同意」, Option B): `element:number`'s `filter` was the
one `filter` input in `ComponentPropsMap` declared as the MongoDB-style record
(`FilterConditionSchema`) while every sibling (`record:related_list` and its
Add-affordance picker) declared `z.array(ViewFilterRuleSchema)` — so the
filter a list view stores and renders was refused by the KPI element beside
it. The entry now declares the same array form its siblings do.

Sequenced consumer-first (the 2026-08-25 Option-A ordering ruling):
objectui#6828 made `ObjectStackAdapter.aggregate()` lower a rule array through
the same `translateFilterArray` its `find()` path runs before the analytics
wire; the objectui pin carrying it (`d8ec8d6d`) was re-measured before this
declaration moved, and the end-to-end chain is authored array → adapter
lowering → filter AST → accepted by `lowerAnalyticsWhere` (which still refuses
a RAW rule-object array — by design, and unchanged here).

Migration — FROM → TO, one rule per key (several keys AND):

```ts
// before (refused now — `invalid_type` at `filter`, expected array)
filter: { status: 'won' }
filter: { amount: { $gt: 100 } }
// after
filter: [{ field: 'status', operator: 'equals', value: 'won' }]
filter: [{ field: 'amount', operator: 'greater_than', value: 100 }]
```

The ruled migration check ran with the change: the sweep of first-party
corpora (examples/, skills/, create-objectstack, content/docs/, packages/apps/,
spec fixtures) found one `element:number` author writing a record-form
`filter` — a spec test fixture, rewritten to the array form here — and zero
outside the spec package. `ElementNumberPropsParsed` is declared
(ADR-0122: the parsed state now differs on `filter`, whose `operator` is
normalized on parse). `element:record_picker.filter` is not changed here.
