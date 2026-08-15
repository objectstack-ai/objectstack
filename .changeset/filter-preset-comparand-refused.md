---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec,lint): refuse a bare date-range preset name in an ordering filter comparand at publish time (#8793 — the ruled C half of #8690)

**BREAKING** accept-set narrowing on a published authoring surface, landing
after the v17.0.0 cut (the lockstep launch-window convention ships it as
`minor`; the migration prescription is registered under protocol major 18).

`last_7_days` / `last_30_days` / `last_90_days` and their ten calendar
siblings are real, declared preset names — for the dashboard date-filter
positions, where the console lowers them to `{date-macro}` bounds before any
query is sent. Authored as a bare filter comparand nothing resolves them:
measured on #8690, `$gte "last_30_days"` returned HTTP 200 with 0 of 51 rows
where `$gte "{30_days_ago}"` returned the 38 in-window. The engine now
refuses the bare name on a declared temporal field at query time
(`INVALID_FILTER` / 400, PR #8808 — the B half); this change is the
authoring-time half the same ruling shipped alongside it.

**What is refused — ordering positions only, in all three authored filter
shapes:** a `$gt` / `$gte` / `$lt` / `$lte` comparand or `$between` endpoint
on every carrier of `FilterConditionSchema` (dashboard widget filter, dataset
filter, report `runtimeFilter`, page/component filter, rollup filter), a
`greater_than` / `less_than` / `before` / `after` / `between` view filter
rule value, and an ordering `[field, op, value]` filter triple (the latter
two via `@objectstack/lint`'s new gating rule `filter-preset-comparand`,
which also runs at the runtime publish gate for `dashboard` / `view` /
`object` / `page` / `flow` writes). The refusal names the offending value,
the position, and the exact `{date-macro}` window that works.

**What stays accepted:** the preset names in the dashboard date-filter
positions (`dateRange.defaultRange`, a date global filter's `defaultValue`) —
the only positions any layer ever resolved them; equality and membership
comparands (`{ period: 'this_quarter' }`, `$in: [...]`) — a select/picklist
column legitimately stores colliding values, and the engine's field-typed
door already covers the temporal case; undeclared strings
(`'not-a-date-at-all'`) — the field-typed engine door owns those; and the
empty-string cell, which stays its own card by ruling.

## FROM → TO

```ts
// before — parsed green, returned a silent zero (or 400 at query time since #8808)
filter: { closed_at: { $gte: 'last_30_days' } }

// after — rejected naming the window; write the date-macro spelling
filter: { closed_at: { $gte: '{30_days_ago}' } }
// calendar presets prescribe their pair:
filter: { closed_at: { $between: ['{week_start}', '{week_end}'] } }
```

`DATE_RANGE_PRESETS` moved to `@objectstack/spec/data`
(`data/date-range-presets.ts`) with `ui` re-exporting it, so both import
paths keep working; `DATE_RANGE_PRESET_MACRO_WINDOWS` (the per-preset macro
window table the refusals quote) and `isDateRangePresetName` are new exports.

<!-- adr-0087: registered filter-preset-ordering-comparand-refused -->
