---
"@objectstack/spec": minor
---

feat(spec)!: `ComponentPropsMap['element:record_picker'].filter` converges onto the `ViewFilterRule` array form — the last record-form `filter` in the map (#14406, objectui#6206 Option B)

<!-- adr-0087: registered element-record-picker-filter-rule-array -->

**BREAKING** accept-set change on one props-map entry, shipped as `minor` under
the repo's launch-window convention for breaking changes; the migration
prescription is registered under protocol major 18.

One filter orthography platform-wide (maintainer batch adjudication 2026-08-25,
verbatim 「同意」, Option B): after `element:number` converged (#12039 Key 2),
`element:record_picker`'s `filter` was the one `filter` input in
`ComponentPropsMap` still declared as the MongoDB-style record
(`FilterConditionSchema`) while the three array-declared siblings
(`record:related_list`, its nested Add-affordance picker, `element:number`)
declared `z.array(ViewFilterRuleSchema)` — the four `object-*` doors declare
`filter` as `z.unknown()`, #15449 — so the filter a list view stores and
renders was refused by the picker beside it. The entry now declares the same
array form those siblings do, and the `FilterConditionSchema` import that existed for this
one site leaves the file with it.

Sequenced measurement-first, as that convergence had to be: the `record_picker`
read path was measured at the objectui pin before the declaration moved. The
renderer hands `filter` to `query.$filter` and calls `adapter.find()`, whose
`convertQueryParams` lowers a rule array through `translateFilterArray` into
filter AST tuples — the door every list view's stored rule array already takes
— and nothing on that path parses `properties` against the installed spec.

**Migration** (`element-record-picker-filter-rule-array` — listed by
`os migrate meta --from 17` once the protocol major is 18): a record-form `filter: { status: 'active' }` becomes
`filter: [{ field: 'status', operator: 'equals', value: 'active' }]`; an operator
object `{ amount: { $gt: 100 } }` becomes
`[{ field: 'amount', operator: 'greater_than', value: 100 }]`; several keys
become several rules (they AND). The record form is refused at `filter`
(`invalid_type`, expected array). The binding-level `dataSource.filter` on the
same node is a different key and is unchanged by this release.

`ElementRecordPickerPropsParsed` is declared (ADR-0122): the entry's parsed
state now differs from its authored state on `filter` (`operator` normalizes on
parse), so the bare alias is no longer isomorphic.
