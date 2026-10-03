---
'@objectstack/spec': minor
---

feat(spec)!: an `object-metric` page block's `aggregate` and `trend` take the shape the tile reads instead of any value (#21464)

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-object-metric-aggregate-trend-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **Two members are typed.** `ComponentPropsMap['object-metric']` declared `aggregate` and `trend` as `z.unknown()`, although the tile reads each with one shape. Any value passed, and an off-shape one was answered in silence: `aggregate: 'count'` or a function outside the five asked the server for a measure it does not have, so the tile showed an error or, on the client-side fallback, a sum it was not asked for; `groupby` for `groupBy` drew one ungrouped number; a `trend` with no `value` painted a lone `%`, and a misspelled member or direction was not drawn.
- **`aggregate` is the chart aggregate's own vocabulary, by reference** — `{ field?, function, groupBy? }`: `field` and `function` are `ChartAggregateSchema`'s own members (`function` one of `count`, `sum`, `avg`, `min`, `max`, and a `field` for every function but `count`), and `groupBy` is `ChartGroupBySchema`, a field name or a `{ field, dateGranularity?, alias? }` date-bucket node. One thing differs from the chart: `groupBy` is optional, because a metric paints one number over every row.
- **`trend` takes the badge's measured shape**, `{ value, label?, direction? }`: `value` a number (painted as a percentage), `label` a string or an inline locale map, `direction` `up`, `down` or `neutral`.
- **`ObjectMetricProps`** carries these types on the two members instead of `unknown`.
- **`drillDown` and `compareTo` are not narrowed** and still accept any value. Each by-reference candidate disagrees with what the tile reads: the chart's drill-down declares a `filter` the tile never reads and refuses the `report` the tile draws as a report body; the dashboard widget's comparison declares a `dimension` that this path never reads. Each is typed once that fork is ruled.

## FROM → TO

| you wrote on an `object-metric` | write instead |
|:--|:--|
| `aggregate: 'count'` | `aggregate: { function: 'count' }` |
| `aggregate: { function: 'sum' }` | name the field: `aggregate: { field: 'amount', function: 'sum' }` |
| `aggregate: { field: 'amount', function: 'count_distinct' }` (any function outside the five) | one of `count`, `sum`, `avg`, `min`, `max` |
| `aggregate: { field: 'amount', function: 'sum', groupby: 'stage' }` | `groupBy: 'stage'` |
| `aggregate: { function: 'count', dateGranularity: 'month' }` | `aggregate: { function: 'count', groupBy: { field: 'closed_at', dateGranularity: 'month' } }` |
| `trend: 'up'` | `trend: { value: 12, direction: 'up' }` |
| `trend: { value: '12%' }` | `trend: { value: 12 }` (the badge adds the `%`) |
| `trend: { value: 12, direction: 'rising' }` | `direction: 'up'` |

The one-line fix: write each member as the table above shows. No conversion is registered, because an off-shape value has no rewrite that both keeps what the tile shows today and honours what the author wrote; the D3 entry `ui-object-metric-aggregate-trend-typed` carries that judgment.

## Who is affected, measured

A writer is a page-component node: an object literal naming the type, a literal annotated with the block's type, a `schema={{…}}` on the block's React component, the block's React component with the member as a prop, a call into a local helper that builds the node, or a direct parse through the row. Each member's value is read through same-file constants and local helpers. The control is `objectName` on the same nodes.

- **objectstack** at `b610eabf72`, over `examples/`, `packages/` (with `packages/apps/`), `content/`, `skills/` and `apps/`: 22 `aggregate` values, all `{ field, function }` with `count` or `sum` — the showcase's thirteen KPI tiles (`index.ts`, `my-work.page.ts`, `command-center.page.ts`), two in the layout-DSL docs page and seven copies in the spec and lint tests. All parse. No `trend` value is authored.
- **objectui** at the `.objectui-sha` pin `89cad75d55`: 46 `aggregate` and 13 `trend` values on `object-metric`. Every static one parses except two, each a test fixture probing that the tile does not draw the value: an array `groupBy` the data adapter refuses at the producer, and a `trend` carrying two members the badge never draws. The values that are not static are run-time hand-offs (the dashboard relays) and test-loop variables.
- **Deployed metadata** was not measured.
