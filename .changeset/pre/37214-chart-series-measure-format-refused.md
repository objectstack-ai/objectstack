---
'@object-ui/types': minor
'@objectstack/spec': minor
---

feat(types)!: a static chart node's series refuses the renderer-internal `measureFormat` carrier by name

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered chart-series-measure-format-carrier-refused -->

**BREAKING** accept-set narrowing on the static SDUI `chart` node: `ChartDataSeriesSchema` refuses `series[].measureFormat`, and the `ChartDataSeries` TS twin types it `?: never`.

`measureFormat` (`{ format, currency, percentScale }`) is the chart renderer's internal carrier of a dataset measure's display facts. The report and dashboard chart producers fill it from the dataset answer so a value axis prints the measure's units; it is not meant to be authored. Until now the non-strict series schema refused only its sibling `aggregate` by name, so a hand-written `measureFormat` on a static chart node was kept and honoured, and could claim a currency or a percent scale the data does not have.

| FROM | TO |
|:--|:--|
| `{ type: 'chart', series: [{ name: 'amount', measureFormat: { format: '0,0.00', currency: 'CNY' } }] }` | delete `measureFormat`; to print the value axis in a unit, write the axis `format` on the chart: `yAxis: [{ field: 'amount', format: '$0,0' }]` |

The one-line fix: delete `measureFormat` from every authored chart series. The parse now refuses it with one issue at `series.N.measureFormat` naming the key (a series that also writes `aggregate` is refused at both), and a typed `ChartDataSeries` literal that writes it fails `tsc`. Report and dashboard charts are unchanged: their producers keep filling the carrier past this schema. The D3 entry `chart-series-measure-format-carrier-refused` (`@objectstack/spec` migration registry) records the narrowing; there is no D2 conversion, because the carrier has no authored equivalent to rewrite into.
