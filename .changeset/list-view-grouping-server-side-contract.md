---
"@objectstack/spec": minor
---

feat(spec): list-view grouping is server-side — the group header query and the per-group row page compile from the view (#14556)

Maintainer ruling A on objectui#7189 (2026-09-02): grouping on a list view is
server-side. The set of groups and every number in a group header — the count
and any per-group aggregation — are properties of the query, not of the fetched
page; rows inside a group are paged. Grouping one fetched window (the interim
behaviour) rendered two headers (86, 14) or five (31/31/30/7/1) for the same
186 rows in five units depending on row order, and left the rows past the
first window unreachable.

The contract reuses the query shapes the platform already has — no new query
shape, no new engine verb, no new envelope:

1. **The group keys and every header number are ONE aggregate query**
   (`EngineAggregateOptions`, executed by `IDataEngine.aggregate`): `groupBy`
   is `grouping.fields[].field` in nesting order (a multi-level grouping is a
   multi-column `groupBy`), `aggregations` is a `count` node (the group's total
   row count, alias `count`) plus the view's declared column summaries mapped
   onto `AggregationFunction` — the one aggregation vocabulary datasets already
   use — and `where` is the view's composed filter.
2. **The rows inside a group are the existing paged `find`**
   (`EngineQueryOptions`) with the group's key predicate AND-ed into the view
   filter, `limit` / `offset` per group.

New on the `ui` entry, `view-grouping-query.ts`:

- `compileListViewGroupQuery(view, { where?, depth? })` → the header query;
  `compileListViewGroupRowsQuery(view, groupKey, { where?, limit?, offset?, orderBy?, fields? })`
  → the row page; `listViewGroupKeyPredicate` (the empty group is spelled with
  the `$null` predicate — the spelling the view filter dialect's `is_empty`
  lowers to).
- `COLUMN_SUMMARY_AGGREGATION` — the `ColumnSummary` → `AggregationFunction`
  table, exhaustive by type: `count` → a fieldless `count` (`COUNT(*)`),
  `count_unique` → `count_distinct`, `sum` / `avg` / `min` / `max` → the same
  name, `none` → nothing. `count_empty`, `count_filled`, `percent_empty` and
  `percent_filled` have no counterpart yet (`UNMAPPED_COLUMN_SUMMARIES`); a
  grouped view declaring one is refused loudly at compile time with
  `ListViewGroupQueryError` (`NOT_IMPLEMENTED` / 501, the summary's path) —
  their mapping is an open contract question on #14556, and nothing is dropped
  silently in the meantime.
- Result-column naming on a header row: each grouped field under its own name
  (raw stored value, `null` for the empty group), `count`, and each summary
  under `<function>_<field>` (`columnSummaryAlias`).

`GroupingConfigSchema` / `GroupingFieldSchema` / `ColumnSummarySchema` now say
this in their docs. Nothing changes in what parses: no key is added, removed
or re-shaped. `minor` because a new exported helper and a declared contract
semantics ship; not breaking — the page-scoped behaviour was never declared.
The route that carries the header query to the grid is the platform half of
#14556; the grid consuming it is objectui#7189.
