---
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
---

fix(plugin-charts): a pie, donut, funnel or treemap with two dimensions draws every second-dimension group or refuses on the tile, instead of silently drawing the first group only

Clause-②: no
Metadata-protocol: none

A dashboard widget (or a dataset-bound chart) of type `pie`, `donut`, `funnel` or `treemap` with `dimensions: ['stage', 'owner']` and one measure used to draw only the first `owner` value's amounts; every other owner was dropped and nothing on the chart said so. The second dimension reaches the renderer pivoted into one series per value, and these arms read the first series only.

- **Treemap draws every cell.** Two or more series on a treemap are now drawn as two levels: each first-dimension value is a parent, and each second-dimension value it has records for is a leaf inside it, sized by the measure and named `stage / owner`. A cell that is not above zero is left out, and the chart prints the existing "not drawn to scale" note once per second-dimension value that lost a cell; a chart with no cell above zero shows the existing "nothing to size" refusal, naming every value it tested. Clicking a leaf drills to its cell.
- **Pie, donut and funnel refuse on the tile.** A pie slice is one share of one whole and a funnel stage one total, so neither has a place for a second series. Handed two or more, they now draw nothing and show a refusal (`data-chart-error="one-series-family"`) that names every group, instead of the first group's chart.
- **Unchanged:** a chart with one dimension draws exactly as before on all four types, a comparison overlay (`compareTo`) is never read as a group, and a chart with no rows is the empty chart it was. A stored dashboard widget of these types that declares several measures (refused at publish by the spec) is handed only its first measure, as before, so its other measures are not read as groups.
