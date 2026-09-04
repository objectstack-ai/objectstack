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
- `COLUMN_SUMMARY_AGGREGATION` — the `ColumnSummary` → aggregation table,
  exhaustive by type: `count` → a fieldless `count` (`COUNT(*)`),
  `count_unique` → `count_distinct`, `sum` / `avg` / `min` / `max` → the same
  name, `none` → nothing; `count_filled` / `count_empty` / `percent_filled` /
  `percent_empty` map by derivation — one `{ function: 'count', field }` node
  (`COUNT(field)`, the non-null count, header column `count_<field>`), from
  which `deriveColumnSummary(row, summary, field)` computes all four on the
  header row (`count_filled` = `count_<field>`, `count_empty` = `count −
  count_<field>`, `percent_filled` = `count_<field> / count`, 0 when the count
  is 0, `percent_empty` = `1 − percent_filled`). Server-side "empty" is `null`
  on every face; the footer's client-side reading of `''` / `[]` as empty is
  the renderer's to converge. A future member with no counterpart is refused
  loudly at compile time (`ListViewGroupQueryError`, `NOT_IMPLEMENTED` / 501,
  the summary's path — `UNMAPPED_COLUMN_SUMMARIES`, empty today); a value that
  is no member at all is `INVALID_QUERY` / 400.
- Result-column naming on a header row: each grouped field under its own name
  (raw stored value, `null` for the empty group; group keys are scalar), `count`,
  and each summary under `<function>_<field>` (`columnSummaryAlias`).

`GroupingConfigSchema` / `GroupingFieldSchema` / `ColumnSummarySchema` now say
this in their docs, with the shape's recorded limits (a date grouping field
groups per distinct stored instant; header cardinality is unbounded). Nothing
changes in what parses: no key is added, removed or re-shaped. `minor` because
a new exported helper and a declared contract semantics ship; not breaking —
the page-scoped behaviour was never declared. Both queries ride the existing
`POST /data/:object/query` door (`protocol.findData` → `engine.aggregate`,
answering `{ object, records, total, hasMore }`); the grid consuming the header
rows is objectui#7189.
