---
'@object-ui/plugin-charts': patch
---

fix(plugin-charts): a chart's data labels print in their value axis's units, and the tallest mark keeps its label on the chart surface

Clause-②: no
Metadata-protocol: none

- **Units.** With `showDataLabels` on, each value label now prints with the tick formatter of the value axis its series is drawn against. An axis with no authored `format` labels its marks in the same compact units as its ticks (`174K` beside a `400K` tick, where the label used to print `174000`); an authored `yAxis[].format` still wins, per axis on a dual-axis or combo chart. Dashboard charts, whose `chartConfig` carries no axis format, are the common case.
- **Headroom.** A vertical bar, line, area or combo chart with data labels on takes a top margin that fits one label above the plot, so a mark on the top edge of the domain (the tallest bar under a nice top tick) no longer draws its label outside the chart. Charts without data labels, and horizontal bars, keep recharts' default margin.
