---
'@objectstack/spec': minor
---

feat(spec)!: an `object-metric` page block's `aggregate` and `trend` take the shape the tile reads instead of any value (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-metric-aggregate-trend-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **Two members are typed.** `ComponentPropsMap['object-metric']` declared `aggregate` and `trend` as `z.unknown()`, although the tile reads each with one shape. Any value passed, and an off-shape one was answered in silence: `aggregate: 'count'` or a function the engine does not have asked the server for a measure it does not have, so the tile showed an error or, on the client-side fallback, a sum it was not asked for; `groupby` for `groupBy` drew one ungrouped number; a `trend` with no `value` painted a lone `%`, and a misspelled member or direction was not drawn.
- **`aggregate` takes its vocabulary by reference** — `{ field?, function, groupBy? }`: `function` is the query engine's own `AggregationFunction` (`count`, `sum`, `avg`, `min`, `max` or `count_distinct` — the six the tile forwards to the data source), with a `field` for every function but `count`; `groupBy` is the chart aggregate's own `ChartGroupBySchema`, a field name or a `{ field, dateGranularity?, alias? }` date-bucket node, and here it is optional, because a metric paints one number over every row. The chart's aggregate is not taken whole: it requires `groupBy`, and its five functions leave out the `count_distinct` the tile draws.
- **`trend` takes the badge's measured shape**, `{ value, label?, direction? }`: `value` a number (painted as a percentage), `label` a string or an inline locale map, `direction` `up`, `down` or `neutral`.
- **`ObjectMetricProps`** carries these types on the two members instead of `unknown`.
- **`drillDown` and `compareTo` are not narrowed** and still accept any value. Each by-reference candidate disagrees with what the tile reads: the chart's drill-down declares a `filter` the tile never reads and refuses the `report` the tile draws as a report body; the dashboard widget's comparison declares a `dimension` that this path never reads. Each is typed once that fork is ruled.

## FROM → TO

| you wrote on an `object-metric` | write instead |
|:--|:--|
| `aggregate: 'count'` | `aggregate: { function: 'count' }` |
| `aggregate: { function: 'sum' }` | name the field: `aggregate: { field: 'amount', function: 'sum' }` |
| `aggregate: { field: 'amount', function: 'median' }` (any function outside the six) | one of `count`, `sum`, `avg`, `min`, `max`, `count_distinct` |
| `aggregate: { field: 'amount', function: 'sum', groupby: 'stage' }` | `groupBy: 'stage'` |
| `aggregate: { function: 'count', dateGranularity: 'month' }` | `aggregate: { function: 'count', groupBy: { field: 'closed_at', dateGranularity: 'month' } }` |
| `trend: 'up'` | `trend: { value: 12, direction: 'up' }` |
| `trend: { value: '12%' }` | `trend: { value: 12 }` (the badge adds the `%`) |
| `trend: { value: 12, direction: 'rising' }` | `direction: 'up'` |

The one-line fix: write each member as the table above shows. No conversion is registered, because an off-shape value has no rewrite that both keeps what the tile shows today and honours what the author wrote; the D3 entry `ui-object-metric-aggregate-trend-typed` carries that judgment.

## Who is affected, measured

A writer is a value written on an `object-metric`: a page-component node (an object literal naming the type, a literal annotated with the block's type, a direct parse through the row), the block's React component with the member as a prop or inside `schema={{…}}`, or the argument of a local test helper that mounts one. Values resolve through same-file constants; helper arguments and `it.each` rows were resolved by hand. Each value was parsed through the built row.

- **objectstack** at `b610eabf72`, over `examples/`, `packages/` (with `packages/apps/`), `content/`, `skills/` and `apps/`: 22 `aggregate` values, all `{ field, function }` with `count` or `sum` — the showcase's thirteen KPI tiles (`index.ts`, `my-work.page.ts` and the `kpi()` helper in `command-center.page.ts`), two in the layout-DSL protocol page and six copies in the spec and lint tests. 21 parse. The 22nd is the `kind: 'html'` example in `skills/objectstack-ui/rules/pages.md`, `aggregate="count"`, which this row does not judge (the html tier is compiled against the component manifest, not parsed through `ComponentPropsMap`). No `trend` is authored.
- **objectui** at the `.objectui-sha` pin `89cad75d55`: 66 `aggregate` values (64 static) and 12 `trend` values (all static). 63 and 11 parse. The two refused values are test fixtures probing that the tile does not draw them: an array `groupBy` the data adapter refuses at the producer (`objectMetricStructuredGroupBy-8613`), and a `trend` carrying `percent` and `caption`, which the test asserts the badge never draws (`objectMetricTrendMembers-8071`). The two values that are not static are the dashboard relays' run-time hand-offs (`DashboardRenderer`, `DashboardGridLayout`). objectui's unit-rule pin mounts a `count_distinct` tile, which parses.
- **Deployed metadata** was not measured.
