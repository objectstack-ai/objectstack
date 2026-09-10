---
"@objectstack/spec": minor
---

feat(spec)!: the binding-level `dataSource.filter` and the four `object-*` `filter` doors converge onto the `ViewFilterRule` array form — one filter orthography platform-wide reaches the family (#15442, #15449; objectui#6206-B, decision batch #55 option A)

<!-- adr-0087: registered element-data-source-and-object-block-filter-rule-array -->

**BREAKING** accept-set change at five doors — `ElementDataSourceSchema.filter`
(the `dataSource` binding every data-bound page component carries) and
`ComponentPropsMap['object-grid' | 'object-metric' | 'object-kanban' |
'object-calendar'].filter` — shipped as `minor` under the repo's launch-window
convention for breaking changes; the migration prescription is registered under
protocol major 18 as ONE entry for the family.

One filter orthography platform-wide (maintainer batch adjudication 2026-08-25,
verbatim 「同意」; reached these two locations on 2026-09-06, decision batch #55,
verbatim 「同意」, option A: converge family-wide). Until this release the
binding alone declared the MongoDB-style record (`FilterConditionSchema`) — so it
refused the array the consumer's own pins author at that key, and
`element:record_picker` carried two orthographies at two keys resolved through
one `??` in the renderer — while the four `object-*` doors declared `z.unknown()`
and took the record, the ObjectQL AST tuple array and the rule array alike,
silently. All five now declare `z.array(ViewFilterRuleSchema)`, the form every
other `filter` door in the map already carried; the `FilterConditionSchema`
import that existed in `page.zod.ts` for this one site leaves with it.

Sequenced measurement-first, as the family had to be: at the objectui pin
`a472b07` the `object-metric` aggregate path posted an array `where` that
`POST /analytics/query` refused (400 on every array form, #15828), so the
converge was parked behind the pin bump #16626. At the pin this repo builds
against (`53ded82b`, objectui#7754) the adapter lowers an authored array through
`translateFilterArray` and the spec's own `parseFilterAST` sink before the
wire; `ObjectGrid` lowers a rule array through `toFilterNode`; `ObjectKanban` /
`ObjectCalendar` hand it verbatim to `$filter`, where `convertQueryParams`
lowers it; the binding's composition seam AND-combines it with the named view's
rules through `mergeFilterNodes`. Nothing on those paths parses the value
against the installed spec.

**Migration** (`element-data-source-and-object-block-filter-rule-array` —
listed by `os migrate meta --from 17` once the protocol major is 18): a
record-form `filter: { status: 'active' }` becomes
`filter: [{ field: 'status', operator: 'equals', value: 'active' }]`; an
operator object `{ status: { $ne: 'done' } }` becomes
`[{ field: 'status', operator: 'not_equals', value: 'done' }]`; several keys
become several rules (they AND); an AST tuple array
`[['owner_id', '=', '{current_user_id}']]` becomes
`[{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }]` —
placeholders and date macros are unchanged. The record form is refused at
`filter` (`invalid_type`, expected array); the tuple array is refused at
`filter.0` (expected object). The dashboard widget `filter`
(`dashboard.zod.ts`) is a different family and is unchanged by this release
(#15829); `object-grid.defaultFilters` is a different key, not named by the
ruling, and is unchanged.

In-repo authors migrated in the same change: four spec test fixtures at the
binding, five showcase authors (`my-work.page.ts`, `index.ts`) and three lint
fixtures. Type aliases: `ElementDataSourceParsed`, `ObjectMetricPropsParsed`,
`ObjectKanbanPropsParsed` and `ObjectCalendarPropsParsed` are declared (ADR-0122:
`operator` normalizes on parse, so input ≠ infer at these five schemas now).
