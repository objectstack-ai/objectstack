---
'@objectstack/lint': patch
---

`chart-config-missing` no longer fires on a widget whose binding the renderer derives

The rule warned on every chart-family widget that declared no `chartConfig`, on the
stated grounds that "the renderer cannot determine which measure to plot, so the series
renders empty". Measured against the `@object-ui` revision this repo pins
(`.objectui-sha`), that consequence is false: `DatasetWidget` derives the x-axis key and
one series per measure from the widget's own `dimensions` / `values` via
`buildChartSeries`, and refuses an authored `ChartAxis.field` / `ChartSeries.name`
outright — `chartConfig` carries presentation only. The renderer pins this by name:
"ignores an authored axis `field` and keeps the derived axis binding", "ignores an
authored series and keeps one derived series per measure", "emits none of the
presentation keys when no chartConfig is declared".

The false finding was landing on this platform's own shipped metadata — the
`system_overview` dashboard's pie and bar tiles, on the Setup board every customer opens
first — which is the ADR-0072 D1 cost the rule family exists to avoid.

The rule id is unchanged and keeps one true arm: a `combo` widget with no `chartConfig`,
whose per-series mark is authored as `chartConfig.series[].type` and has no other
channel, so every measure draws with the same default mark and the chart is not a
combination at all. Its message now names that consequence instead of the binding.
An existing `suppressWarnings: ['chart-config-missing']` entry stays valid.
