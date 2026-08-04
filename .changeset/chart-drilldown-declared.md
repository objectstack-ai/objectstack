---
"@objectstack/spec": minor
"@objectstack/lint": minor
---

feat(spec,lint): declare the chart segment drill — `ChartDrillDownSchema`, on the react tier where it is actually read (#5022)

`drillDown` has driven a real capability since long before this release: click a
bar or a slice on an `<ObjectChart>` and objectui opens the underlying records,
filtered by the clicked category, in a drawer. The protocol declared it
**nowhere**. objectui read it as `(schema as any).drillDown`, so every key inside
it — right, wrong, or misspelled — reached the renderer unchecked, and a typo was
simply ignored at click time. This is Prime Directive #10 inverted: not declared
without being delivered, but delivered without ever being declared.

It is declared now, as `ChartDrillDownSchema`, and it is **additive** — nothing
that parsed before stops parsing.

## What you can write

`drillDown` is a prop on the react-tier `<ObjectChart>` block:

```jsx
<ObjectChart objectName="opportunity"
             aggregate={{ function: 'sum', field: 'amount', groupBy: 'stage' }}
             drillDown={{ columns: ['name', 'amount'], maxRows: 50 }} />
```

| key | type | meaning |
|---|---|---|
| `enabled` | `boolean` | Only needed to force the drill OFF — the block being present already means on, so `drillDown={{}}` enables it |
| `filter` | `Record<string, unknown>` | Filter for the drilled list; values support `${event.*}`. Omit it and the filter is derived from `aggregate.groupBy` equal to the clicked category |
| `title` | `string` | Drawer/dialog heading; supports `${event.*}` |
| `target` | `'drawer' \| 'dialog'` | In-place side sheet (default), or a centered modal when the chart is already inside a drawer |
| `columns` | `string[]` | Column whitelist for the drilled list |
| `maxRows` | `number` | Rows per page in the drilled list |

Every one of those six is a key objectui's `ObjectChart` was measured to read.
The renderer's own drill type is wider — it is shared with the table / pivot /
metric widgets — and the extra keys are **deliberately not declared**, because a
chart reads none of them:

- **`mode`** (`'filter'`/`'record'`) is a table/pivot/metric key. A chart segment
  is always an aggregate, so there is nothing to discriminate.
- **`report`** (drill into a report instead of a record list) is a metric/pivot
  capability.
- **`view`** and **`sort`** are read by *no* renderer at all (objectui#3354).
- **`target: 'navigate'`** is implemented for the other widgets but not for a
  chart, which falls back to the drawer.

Writing any of them is now a loud rejection that says which surface owns it,
rather than a value that silently does nothing.

## Where it is NOT declared, and why that is deliberate

**Not on `ChartConfigSchema`, and not a dashboard widget key.** A dashboard
widget has no per-widget drill configuration, by design: an ADR-0021
dataset-bound widget drills through the semantic layer, deriving the target
object and filter from the dataset row that was clicked. That is what
`content/docs/ui/dashboards.mdx` has said all along, and it is what the renderer
does — `DashboardRenderer` never reads `chartConfig`, and `DatasetWidget`
forwards exactly one key out of it (`showLegend`). Declaring the drill there
would have produced authorable metadata that parses clean and never reaches a
renderer — the failure this campaign removes elsewhere.

So the three places an author might reach for it now answer instead of shrugging:

- `widget.chartConfig.drillDown` → rejected, pointing at the react-tier prop.
- `widget.drillDown` / `widget.drilldown` → rejected, explaining that dashboard
  drill-through is **automatic**, and naming both configurable drills.
- `report.drillDown` → rejected, pointing back at the chart prop.

## `drillDown` is not `drilldown`

Two capabilities, one letter apart, and they are now disambiguated in both
directions at the schema gate:

|  | `drillDown` | `drilldown` |
|---|---|---|
| spelling | camelCase | all lowercase |
| type | configuration object | boolean |
| surface | react `<ObjectChart>` prop | `ReportSchema` key (ADR-0021 D2, on by default) |

Edit distance alone gets this wrong — the two spellings are a distance of 1, so a
plain "did you mean" would happily send an author writing `drillDown` on a report
to `drilldown`, where their config object then fails a second time as a boolean.
Both gates name the **type** difference, not just the spelling.

## Enforced, not just declared

`@objectstack/lint`'s react-page publish gate now **parses** the schema
(`react-chart-drilldown-invalid`) against a static `drillDown={{…}}` literal,
rather than re-deriving the rules. Unknown keys, the wrong `target`, and the
near-key spelling all fail the build with the schema's own prescription. A value
assembled from React state is skipped, unchanged: an unresolvable binding is not
a wrong one (ADR-0072 D1).
