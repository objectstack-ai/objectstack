---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

`<ObjectChart>` aggregate result-column naming is now a contract, and its axis bindings are validated (issue #3701)

Split out of #3583 Phase 2 (#3684), which extended ADR-0021 axis checking to
report charts, list-view charts, and dataset-bound page chart components but had
to leave the react `<ObjectChart>` block out: it is OBJECT-bound (`objectName` +
an inline `aggregate`), `aggregate` existed in the contract only as the
description string `'{ field, function, groupBy }'`, and nothing in the repo said
what the aggregated result columns were called. Without that, `xAxis`/`yAxis` had
nothing to resolve against, and guessing a convention would have manufactured
false positives (ADR-0072 D1).

**The convention, recorded rather than invented.** Every path that can serve an
object-bound chart already agreed — the engine's structured-`groupBy` aggregate
(whose alias objectui sets to `field || function`), the legacy analytics query
(which remaps its measure key back to `field`), the client-side fallback, and the
console's own chart-view wiring (`xAxisKey: groupBy`, `series[].dataKey: field`).
`packages/spec/src/ui/chart-aggregate.ts` writes it down and exports it:

* an object-bound aggregate returns rows keyed by the **raw field names** —
  `groupBy` for the category column, `field` for the value column, the literal
  `count` for a fieldless count, plus `<field>__comparison` under a comparison
  overlay;
* `chartAggregateCategoryKey` / `chartAggregateValueKey` / `chartAggregateResultKeys`
  derive those columns so producers and checkers cannot re-derive them apart;
* `ChartAggregateSchema` replaces the description string with a real Zod schema
  and rejects a non-`count` function with no `field` (which used to reach the
  renderer as `sum(undefined)` and render blank).

This is the deliberate opposite of the dataset path, whose rows are keyed by the
declared measure `name` (`sum_amount`) — the trap `chart-measure-unknown` catches.
Only the dataset path has an author-chosen name to key by.

**`<ObjectChart>`'s contract now names the props it actually reads.** The block
consumes `xAxisKey` and `series[].dataKey`; `ChartConfig`'s `xAxis`/`yAxis`/`series`
shapes reached it and were silently dropped, which ADR-0078 forbids. They are
removed from the block's `dataProps`; `chartType`, `xAxisKey`, and `series` are
declared in the React overlay where the other bindings live.

**`validate-react-page-props` now reads attribute VALUES**, not just names, for
`<ObjectChart>`:

* `react-chart-field-unknown` (error) — `aggregate.field` / `aggregate.groupBy`
  naming a field the bound object does not declare;
* `react-chart-aggregate-invalid` (error) — an unimplemented aggregation
  function, or a non-`count` function with nothing to aggregate;
* `react-chart-axis-unknown` (error) — `xAxisKey` / `series[].dataKey` naming a
  column the aggregate does not return (including a dataset-style `sum_total`),
  or a category axis bound to the value column;
* `react-chart-axis-inert` (warning) — the `xAxis` / `yAxis` shapes this block
  never reads.

Value reading is opt-in per block and evaluates only static literals: a prop
driven by React state or a variable, a usage carrying a `{...spread}`, a chart
given inline `data`, and objects another package defines are all skipped
silently — an unresolvable binding is not a wrong one.
