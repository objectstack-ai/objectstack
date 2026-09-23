---
'@objectstack/spec': patch
---

`packages/spec/src/migrations/registry.ts`: the shipped ADR-0087 semantic entry `filter-preset-ordering-comparand-refused` listed a page filter and a component filter among the `FilterConditionSchema` carriers, and said the schema door and the `@objectstack/lint` `filter-preset-comparand` rule refuse a bare date-range preset there at publish. Both are `ViewFilterRuleSchema` rule arrays, and a rule array carries no preset check, so an upgrader who swept stored pages with a schema parse found nothing and concluded the sweep was clean. The entry's `surface`, `reason` and `acceptanceCriteria` now put each carrier under the door that actually refuses it.

Clause-②: no

No behaviour moves. No schema, accept set or lint rule is touched, and no export is added, removed or retyped. Every line this change edits in `registry.ts` is a string literal inside that one step-18 entry, which the exported `MIGRATIONS_BY_MAJOR` carries, so what moves in `dist` is prose.

- **The three groups the entry now draws.** Each was measured against the built `dist` with a preset comparand (`last_30_days`, and `today` as a `between` endpoint), and an ISO-date dark control reads green in every cell.
  1. Slots typed `FilterConditionSchema`: `DashboardWidgetSchema.filter`, `GlobalFilterOptionsFromSchema.filter`, `DatasetSchema.filter`, `DatasetMeasureSchema.filter`, `ReportSchema.runtimeFilter`, `JoinedReportBlockSchema.runtimeFilter`, `FieldSchema.relatedListFilter` and `FieldSchema.summaryOperations.filter`. A parse of the declaring schema refuses each one at the comparand's own path, and the lint rule reports each one as well.
  2. `ViewFilterRuleSchema` rule arrays under a key the lint walks: a view's `filter`, a page element's `dataSource.filter` and a page component's `filter` prop. These parse green, and the lint rule alone refuses them.
  3. A page's `interfaceConfig.filterBy` parses green and also lints green, because the lint's filter walk does not descend that key. Neither door refuses it at publish, so the entry now tells the upgrader to sweep it by hand. Two controls back this reading. A malformed `filterBy` value is refused at `interfaceConfig.filterBy.0.value`, so the slot is parsed. The same rule under `interfaceConfig.filter` is refused by the lint, so the key name is what decides.
- **Two more false sentences are narrowed.**
  - The `replacement` called the dashboard date-filter positions "the only place any layer ever resolved" a preset name. An analytics query's `timeDimensions[].dateRange` accepts and resolves the names too.
  - The `reason` said equality and membership "are NOT judged". That holds for the schema door only. The lint rule refuses a preset in an equality or membership position on a declared `date` or `datetime` field, while `this_quarter` on a `select` field stays green.
- **Reach.** Counted over `dist/index.js`, `dist/index.mjs`, `dist/browser/index.js` and `dist/browser/index.mjs`:
  - The removed carrier list `page filter, component filter, rollup filter` and each of the four other removed claims read 4 before and 0 after.
  - Each of five sentences unique to the corrected text reads 0 before and 4 after.
  - The unchanged dark control `compared false against every row: HTTP 200` reads 4 on both sides.
