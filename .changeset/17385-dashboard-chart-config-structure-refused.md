---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

**BREAKING** — a dataset-bound dashboard widget's `chartConfig` carries appearance only: `type`, `xAxis`, `yAxis` and `series` are refused by name, each refusal naming the dataset selection the intent belongs in.

Clause-②: yes (narrowing)

`DashboardWidgetSchema.dataset` is REQUIRED, so **every** dashboard widget is dataset-bound, and ADR-0021 already made the dataset the owner of the chart's structure: it decides which series exist and which column each one reads. `chartConfig` nonetheless declared `type` / `xAxis` / `yAxis` / `series`, and the two answers met with no rule between them. That was not merely inert. An authored `yAxis[].field` was a live MEMBERSHIP channel — the renderer synthesised a series from the authored axes when the chart declared none — so one authored axis could silently re-point a dataset-bound series at a different column while the chart still drew, which reads as a true statement about the data. Maintainer ruling 2026-09-12, decision batch #121 item 1, verbatim 「同意」, on options C+D together: state the ownership split in the protocol AND refuse the four keys by name.

## FROM → TO

| you wrote inside `chartConfig` (17.4 and earlier) | write instead |
| --- | --- |
| `type: 'line'` | `type: 'line'` on the WIDGET, beside `dataset` — the widget's own `type` is the chart family and it always won; nothing on this face ever read the chart config's |
| `xAxis: { field: 'stage' }` | `dimensions: ['stage']` on the widget — the dataset dimension the category axis plots |
| `yAxis: [{ field: 'amount' }]` | `values: ['amount']` on the widget — the dataset measures, one entry per mark. A second axis is a second measure, not a second axis declaration |
| `series: [{ name: 'amount' }]` | `values` (plus a second `dimensions` entry to split) — series membership follows the selection; an entry naming a measure outside it was already being ignored |

**The one-line fix:** delete the four keys; the widget's `type` and its `dimensions` / `values` are the chart's structure.

`os migrate meta --from 17` lists the mechanical edits for existing sources; apply them by hand.

## What is NOT retired

The keys stay authorable on `ChartConfigSchema` itself, and that is the half a blanket refusal would have broken. A react-tier `<ObjectChart data={…} />` binds inline rows with no dataset behind them, so its axes are the author's and are unchanged — `react-blocks.ts` still publishes all four in that block's `dataProps`. `ReportChartSchema` keeps its own `xAxis` / `yAxis`, narrowed to its bound dataset's dimension and measure names. The refusal lives on a new per-carrier `DashboardWidgetChartConfigSchema` (`ChartConfigSchema.extend(…)`, the `ReportChartSchema` spelling) precisely so it cannot reach those two.

## What this costs, stated rather than discovered

`xAxis` / `yAxis` / `series` carried presentation alongside the binding — axis titles, number formats, bounds, grid lines, log scale, and per-series labels, colours, stacking and mark types. Refusing the keys takes the presentation with the binding: a dataset-bound chart takes those from the dataset's own dimension and measure declarations, and `colors` on the chart config remains the palette channel. **The combo chart a dataset-bound widget could author through `series[].type` has no authoring channel on this face any more.** That capability loss is ruled, not incidental — the option that kept it was on the table and was not taken.

## Accept-set movement, both directions

Narrowing, on a dataset-bound widget: the four keys move from accepted to refused. **And one widening, which is forced by the ruling rather than chosen:** `ChartConfigSchema.type` is REQUIRED, so before this change a `chartConfig` without a `type` was refused as incomplete. Refusing `type` while keeping the bag authorable for appearance — which ruling item 1 requires in as many words — means absence must now be legal. So `chartConfig: { title: 'Revenue' }` on a dashboard widget moves from refused to accepted. That is why the declaration reads `yes (narrowing)` rather than `no`.

## The retirement kit

- **Four `retiredKey()` tombstones on the widget carrier**, registered as `ui/DashboardWidgetChartConfig:type` / `:xAxis` / `:yAxis` / `:series` under protocol 18. `tsc` types each key `never`, so every authoring site in a consumer's tree fails to compile before anything runs, and a value that reaches a parse raises the prescription rather than a bare unrecognized-key report.
- **The ADR-0087 pair.** The D2 conversion `dashboard-widget-chart-config-structure-removed` strips the four keys from stored dashboard widgets (dashboards only — reports and the react tier keep theirs); the D3 semantic entry `dashboard-widget-chart-config-structure-refused` carries the judgement, because moving what the keys MEANT into the dataset selection needs facts the widget does not hold — an authored axis field can name a dataset dimension the widget never selected.
- **The liveness rows stay and are regraded `dead`**, the `retiredKey` route's discipline: the tombstone keeps the key in the walked shape, so the row remains and records why. Three of them were graded `live` on their presentation half on 2026-09-12 and that measurement is recorded as overridden, not withdrawn.
- **`chart-config-missing` is withdrawn from `@objectstack/lint`.** It advised a `combo` widget with no `chartConfig` to declare `chartConfig: { series: [{ name, type }] }` — metadata the schema now refuses — and after the ruling there is nothing a `combo` author can do about the finding. The rule ID stays exported, so an existing `suppressWarnings: ['chart-config-missing']` entry keeps parsing. `chart-field-unknown` still fires on a legacy document and its hints now say delete-and-migrate instead of describing what the keys used to carry.

## What an operator with a STORED dashboard sees

A `sys_metadata` `dashboard` row written before this release can carry any of the four. Nothing breaks at read: the conversion replays on rehydration and strips them, so the row is served canonical, and `os migrate meta --stored --apply` rewrites the rows. ⚠️ The strip is the mechanical half only. A widget whose authored axes AGREED with its selection renders identically afterwards — that is the expected case. A widget that renders differently was relying on the membership channel this removes, which is the case the ruling was made about.

<!-- adr-0087: registered dashboard-widget-chart-config-structure-removed, dashboard-widget-chart-config-structure-refused -->
