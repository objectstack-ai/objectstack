---
"@objectstack/spec": patch
---

Documentation: the analytics `where` contract and the `element:number` D3 entry now name the hop an array filter is lowered at.

Text only — no schema, accept-set, runtime or test behaviour changes. `AnalyticsQuerySchema.where` is still `FilterConditionSchema` and still refuses an array, which is the protocol working as `FilterArray`'s docblock (#5158 ruling C) declares it: a `FilterArray` is input-only authoring sugar, lowered to a `FilterCondition` at the single sink `parseFilterAST` (`@objectstack/spec/data`) the moment it arrives, and only the lowered `FilterCondition` travels any further.

- `AnalyticsQuerySchema.where`'s `.describe()` gains one sentence pointing array authors at that lowering: an authored `FilterArray` is lowered by `parseFilterAST` on the client before the wire, and this field admits only the lowered `FilterCondition`. It lands in the generated `content/docs/references/{api,data}/analytics.mdx` prop tables, which is where an author reads it.
- The `element-number-filter-rule-array` semantic migration entry recorded its runtime prerequisite one hop too late: "authored array → adapter lowering → filter AST → accepted by `lowerAnalyticsWhere`". `lowerAnalyticsWhere` (`service-analytics`) is the in-process door (#5334) for callers reaching `analyticsService.query` directly. The wire's door is the runtime route `POST /analytics/query`, which parses `where` with `AnalyticsQueryRequestSchema` before any service code runs, so an un-lowered array is refused there. The entry's reason clause now names that route hop and the `parseFilterAST` lowering the adapter owes before the wire (#15828; the adapter-side fix is objectui#7752).

The sibling entry `element-record-picker-filter-rule-array` was read for the same claim and does not make it — its measured path is `find()` / `convertQueryParams`, not the analytics wire — so it is unchanged.
