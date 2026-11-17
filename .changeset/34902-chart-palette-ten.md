---
'@object-ui/components': patch
'@object-ui/console': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
---

fix(charts): the default categorical palette has ten distinct theme colours, so a pie or donut with six to ten slices no longer repeats a colour

Clause-②: no
Metadata-protocol: none

The theme stylesheets (`@object-ui/components` and the Console) now define `--chart-6` to `--chart-10` beside `--chart-1` to `--chart-5`, in light and dark, with matching `--color-chart-N` aliases. The chart fallback palette (`AdvancedChartImpl`) and the dashboard relay palette (`DashboardRenderer`, `DashboardGridLayout`) read all ten. Before, they read five and cycled, so slice six took slice one's colour and the legend could not tell them apart. An authored `colors` palette still wins over the default.
