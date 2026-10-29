---
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
---

fix(plugin-charts): a sankey with two dimensions draws every flow from the first dimension to the second, instead of only the first second-dimension group's

Clause-②: no
Metadata-protocol: none

A dashboard widget (or a dataset-bound chart) of type `sankey` with `dimensions: ['status', 'category']` and one measure used to draw a single root node, the first `category` value, with only that value's flows; every other `category` value was dropped and nothing on the chart said so. The second dimension reaches the renderer pivoted into one series per value, and the sankey read the first series only.

- **Every cell is a flow.** Two or more series on a sankey are now drawn as two columns of nodes: each first-dimension value flows into each second-dimension value it has records for, and the flow's width is the measure. A combination the dataset did not answer is no flow and is not reported as missing.
- **A partial flow says so.** A cell that is not above zero cannot be drawn as a flow; the chart prints the existing omitted-rows note once per second-dimension value that lost a cell, and a chart with no cell above zero shows the existing "no flow to draw" refusal, naming every column it tested.
- **Clicking a flow drills to its cell**, the one dataset row for that pair. A node spans several cells, so a node click does not drill.
- **Unchanged:** a sankey with one series draws the same one-level flow from the measure to each category. A comparison overlay (`compareTo`) is never drawn as a flow. A stored sankey widget that declares several measures (refused at publish by the spec) is handed only its first measure, as before, so its other measures are not drawn as groups.
