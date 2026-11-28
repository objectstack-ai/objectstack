---
'@object-ui/plugin-report': patch
---

fix(plugin-report): a report never draws a new selection over the previous selection's rows

Clause-②: no
Metadata-protocol: none

A dataset report's table, matrix and chart answered a new selection, for one render, with the rows of the selection before it, because the query for the new one runs only after that render. Turning 「Compare with previous period」 on drew the comparison series over rows that carry no comparison values, a frame the browser could paint before the chart turned to "Loading chart…". Each outcome now answers only the selection it was queried for, and under any other selection reads as loading. A re-read of the same selection (a data change on the object) still keeps its rows on screen until the new answer lands. Nothing to migrate.
