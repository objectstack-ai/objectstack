---
'@objectstack/lint': minor
---

`chart-field-unknown` drops to `warning` on the three `chartConfig` binding keys the pinned renderer refuses, and says what actually happens

The rule id covers exactly three positions, and the `@object-ui` revision this repo pins (`.objectui-sha`) refuses all three as bindings, so none of them can produce the data failure the messages described:

- `chartConfig.xAxis.field` — `axisPresentation` (`@object-ui/core` `src/utils/chart-presentation.ts`) builds the axis presentation **minus** its `field`. The x-axis key is `buildChartSeries`' `xAxisKey`, i.e. the widget's `dimensions[0]`; an authored `field` re-points nothing.
- `chartConfig.yAxis[].field` — the same call, per entry. The entry keeps its slot (the count is what turns on a secondary axis) and its scale and chrome; only the binding is dropped.
- `chartConfig.series[].name` — `mergeAuthoredSeries` pairs an authored entry with the derived series whose `dataKey` it equals, one per entry of `values`. An entry naming no derived series is ignored whole, so the presentation hung on it — the mark, the colour, the stack, the axis side — lands on nothing.

The renderer pins this by name in `DatasetWidget.chartConfig.test.tsx` ("ignores an authored axis `field` and keeps the derived axis binding", "ignores an authored series and keeps one derived series per measure").

So the old message — "the query result will not contain it" — named a query failure that never happens, and `error` blocked a build and a Studio publish for a key that changes nothing at runtime. That is the class `widget-legacy-analytics-shape` reports at `warning` in the same file ("the dashboard renderer ignores them … a silent no-op"), and this id now carries the same tier, the same suppressibility (`suppressWarnings: ['chart-field-unknown']` per widget) and the same kind of sentence. Each message states its own consequence, because the axis positions and the series position are refused for different reasons.

The finding is **kept**, not deleted: unlike the `chart-config-missing` over-reach this measurement came from, the metadata really is wrong — the author wrote a binding and believes it is in force.

## Migration

**A publish that used to be refused now succeeds.** Ruled 2026-08-15, `validateWidgetBindings` put its whole error set on the `sys_metadata` publish door (Studio / REST `/meta` / MCP) as one "this board cannot render" reference-integrity class. That class was six ids and is now five — `chart-field-unknown` has left it. A dashboard write whose only reference-integrity problem is a refused `chartConfig` binding key is no longer a 422 `INVALID_METADATA`; it publishes, and the finding rides the non-blocking `advisories` channel on the 2xx response instead. The other five (`widget-dataset-unknown`, `widget-dimension-unknown`, `widget-measure-unknown`, `widget-legacy-analytics-unrenderable`, `dashboard-filter-field-unknown`) are unchanged.

Same direction on the CLI: `os validate` / `os build` / `os lint` report the finding at `warning`, so a stack that used to fail the build over one of these keys now exits 0 with an advisory. If you were relying on the build to stop on it, add the key to your own gate, or fix the binding — the fix has not changed:

- point `xAxis.field` at a dimension the widget selects (or drop the key — `xAxis` carries presentation only);
- point `yAxis[].field` at a selected measure (or drop it — `yAxis[]` carries presentation only);
- name a selected measure in `series[].name`, remembering that post-cutover (ADR-0021) result rows are keyed by the dataset's measure **name** (`sum_amount`), not the base column (`amount`).

A deliberately inert key can be silenced per widget with `suppressWarnings: ['chart-field-unknown']`.
