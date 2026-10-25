---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec,lint): a list-view grouping level can order its groups by another field (`grouping.fields[].orderBy`)

Clause-②: yes
Metadata-protocol: added

- **Before.** A grouping level ordered its groups only by its own key. A period label grouped as text (`Nov 2026`, `Oct 2026`, `Q1 2027`, `Q4 2025`), so putting periods in time order took a second, outer grouping level on the period start, which showed two header rows for every group.
- **Now.** `GroupingFieldSchema` gains `orderBy`, the name of a field on the same object whose value orders this level's groups: `{ field: 'period_label', orderBy: 'period_start', order: 'desc' }`. When it is absent, or names the grouping field itself, the groups order by their own key as before. Nothing is defaulted in.
- **What the header query carries.** The consumer still sorts the header rows. `compileListViewGroupQuery` now adds the value to sort by: one `min` node over `orderBy` for `order: 'asc'`, or one `max` node for `'desc'`, under `min_<field>` / `max_<field>`. Each group sits where its first row would sit if the rows were sorted by `orderBy` in `order`. The grouping key stays the only `groupBy` column, so there is one header per label. A column summary that already declares the same `min` is the same node and the same column. In a multi-level grouping the outer level's value folds exactly from the leaf rows (the `min` of mins, the `max` of maxes).
- **`listViewGroupOrderColumn(grouping, level)`** (`@objectstack/spec/ui`) names the header-row column a level sorts by: the grouping field itself, or the order node's alias. A consumer reads this instead of rebuilding the alias. A group whose order value is `null` sorts last in both directions, and equal values fall back to the group key.
- **Refused, at compile and at authoring.** A blank `orderBy` is refused by the compiler (`grouping_order_by_blank`, `INVALID_QUERY` / 400) and by the schema (`too_small`). An order alias that lands on a grouped field's own column is `alias_collision`. `os validate`, `os build` and the runtime save door judge `orderBy` the way the aggregate door does. An unknown name is `list-view-field-unknown`. A dotted path is `list-view-field-dotted`, because the header query compiles no join. A field whose type `min` / `max` cannot order on every backend is the new `list-view-group-order-unorderable` (`error`). That covers the string classes, whose order depends on the collation, and the virtual `formula`. Each of these is refused `400 INVALID_FIELD` by `engine.aggregate`, so the grouped view would render no group.
- **Unchanged.** `order` and `collapsed` keep their meaning and defaults. The row page query (`compileListViewGroupRowsQuery`) does not change. `EngineAggregateOptions` gains no `orderBy`, because the group sort stays the consumer's. The new key is purely additive, so a grouping declared today compiles to exactly the same query.
