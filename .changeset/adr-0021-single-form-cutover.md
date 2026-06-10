---
"@objectstack/spec": major
---

ADR-0021 single-form cutover (BREAKING): the inline analytics author surface is
removed — every dashboard widget, report, and list-chart must now bind a
semantic `dataset` and select dimensions/measures **by name**.

Removed from the spec:

- **DashboardWidget** — `object`, `categoryField`, `categoryGranularity`,
  `valueField`, `aggregate`, `measures` (and the `WidgetMeasure` schema/type).
  `dataset` + `values` are now required; `filter` is the presentation-scope
  runtimeFilter; `dimensions` / `compareTo` are retained.
- **Report** — top-level (and joined-block) `objectName`, `columns`,
  `groupingsDown`, `groupingsAcross`, `filter`. A non-joined report now requires
  `dataset` + `values`; `rows` are the dimensions.
- **ListChart** — `xAxisField`, `yAxisFields`, `aggregation`, `groupByField`.
  `dataset` + `values` are now required.

Migration: replace the inline query with a `defineDataset(...)` and reference it
by name. A flat record listing (the former `tabular` report / inline list) is an
object-bound ListView (ADR-0017), not an analytics dataset. See
`docs/adr/0021-analytics-dataset-semantic-layer.md` and the
`content/docs/guides/analytics-datasets.mdx` guide.
