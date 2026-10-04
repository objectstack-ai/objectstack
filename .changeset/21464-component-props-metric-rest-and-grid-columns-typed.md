---
'@objectstack/spec': minor
---

feat(spec)!: an `object-metric` page block's `drillDown` and `compareTo`, and an `object-grid` page block's `columns`, take the shape each block reads instead of any value (#21464)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-metric-compare-to-typed, ui-object-metric-drill-down-typed, ui-object-grid-columns-typed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`object-metric` `compareTo` takes the tile's read, `{ kind }`.** It was `z.unknown()`, although the tile reads `kind` alone: a bare `'previousYear'` or a kind outside the two compared against the previous period, and a `dimension` was carried and never read. `kind` is the dashboard widget comparison's own vocabulary by reference (`previousPeriod`, `previousYear`). `dimension` is refused by name, with the prescription: this inline tile shifts the date macros in its own `filter` and never reads a dataset time dimension, so state the window on the tile's `filter`.
- **`object-metric` `drillDown` takes the tile's read.** It was `z.unknown()`: a drill `filter`, a `mode` or a misspelled member passed and was ignored. Its five list members — `enabled`, `title`, `target` (`drawer`, `dialog`, `navigate`), `columns` (field names) and `maxRows` (a positive whole number) — are the chart drill-down's own by reference. `filter` and `mode` are refused by name: a metric tile has no click event for a drill filter to resolve against (the drilled list is scoped by the metric's own `filter`), and no row for `mode` to open as a record. The chart's drill-down shape is not taken whole, because it declares `filter`.
- **The drill-down's `report` is not narrowed** and still accepts any value. The tile draws a dataset-bound report through the shared drill drawer, but no spec drill shape declares a `report` member yet; it is typed once the spec declares the drill report.
- **`object-grid` `columns` takes the list view's own `columns`**: all field-name strings, or all column entries `{ field, label?, width?, align?, hidden?, sortable?, resizable?, wrap?, type?, pinned?, summary?, prefix?, link?, action? }`. It was an array of `z.unknown()`, held at the second stage because the grid's group headers drew a column's `options`, which the column entry does not declare. The renderer has since retired that read (the group-header labels come from the object field's `options` only), so the hold is lifted. A column keyed `accessorKey` / `header` or `name`, a column with no `field`, a list mixing strings and entries, or a column key the entry does not declare (`editable`, `options`, `reference`, or a footer number hint such as `currency` or `precision`) is refused.
- **`ObjectMetricProps` and `ObjectGridProps`** carry these types on the three members instead of `unknown`. A parsed column's `prefix.type` now carries the list view's `'text'` default.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `object-metric` `compareTo: 'previousYear'` | `compareTo: { kind: 'previousYear' }` |
| `object-metric` `compareTo: { kind: 'previousYear', dimension: 'close_date' }` | `compareTo: { kind: 'previousYear' }`, with the window stated on the tile's own `filter` (date macros such as `{current_quarter_start}`) |
| `object-metric` `compareTo: { kind: 'previousQuarter' }` | `previousPeriod` (the equal-length window before the one the filter resolves to) or `previousYear` |
| `object-metric` `drillDown: { filter: { stage: 'won' } }` | delete it, and scope the metric with its own `filter` (the drilled list follows it) |
| `object-metric` `drillDown: { mode: 'record' }` | delete it — a metric always lists the records behind its number |
| `object-metric` `drillDown: { limit: 50 }` | `drillDown: { maxRows: 50 }` |
| `object-grid` `columns: [{ accessorKey: 'amount', header: 'Amount' }]` | `columns: [{ field: 'amount', label: 'Amount' }]` |
| `object-grid` `columns: [{ name: 'salary' }]` | `columns: [{ field: 'salary' }]` |
| `object-grid` `columns: ['name', { field: 'amount', width: 120 }]` | all entries: `[{ field: 'name' }, { field: 'amount', width: 120 }]` |
| `object-grid` a column `editable`, `options`, `reference`, `currency` or `precision` | delete the key: inline editing is the grid's own `editable`, and option labels, relational metadata and number formats are the object field's |

The one-line fix: write each member as the table above shows. No conversion is registered, because a refused value has no rewrite that both keeps what the block shows today and honours what the author wrote; the D3 entries `ui-object-metric-compare-to-typed`, `ui-object-metric-drill-down-typed` and `ui-object-grid-columns-typed` carry that judgment.

## Who is affected, measured

A writer is a value written on the block: a page-component node (an object literal naming the type, a literal annotated with the block's type, a direct parse through the row), the block's React component with the member as a prop or inside `schema={{…}}`, or the argument of a local test helper that mounts one (positional helper parameters resolved at every call site). Values resolve through same-file constants. Each static value was parsed through the row.

- **objectstack** at `6ec54f00ba`, over `examples/`, `packages/` (with `packages/apps/`), `content/`, `skills/`, `apps/` and `docs/`: 5 `object-grid` `columns` values, all field-name strings (the showcase's `my-work.page.ts` and `command-center.page.ts` grids, and three test copies), all parse. No `object-metric` `drillDown` or `compareTo` is authored.
- **objectui** at the `.objectui-sha` pin `ab1879721595`, every one a test fixture or a run-time hand-off:
  - `compareTo`: 5 values, 4 parse. The refused one is the test that asserts a `dimension` never touches the query (`ObjectMetricWidget.compareTo.test.tsx`).
  - `drillDown`: 26 values, 25 static; 23 parse. The two refused are the compile-time refusal probes for `filter` and `mode` (`ObjectMetricWidget.drillDownRefusal-9002.test.tsx`). The one that is not static carries a report probe, which parses, since `report` stays open.
  - `object-grid` `columns`: 362 values, 353 static (147 distinct); 312 parse. Each of the 41 refused is a test fixture whose refused key or entry the grid does not draw: 17 columns keyed `accessorKey` / `header` and 5 keyed `name` (the column-spelling diagnostic, identity and field-security tests); 14 columns carrying `editable: false` and 1 carrying `reference`, keys no read takes off an authored column; 2 carrying `options`, the tests asserting that the group headers no longer read them; 1 column with no `field`; and 1 numeric `columns` refused by objectui's own mirror. The 9 values that are not static are 3 run-time hand-offs (the object view and two designer grids) and 6 test lists built from `{ field, label, type }` entries, which parse.
- **Deployed metadata** was not measured.
