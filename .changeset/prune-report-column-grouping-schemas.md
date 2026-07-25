---
"@objectstack/spec": minor
---

feat(spec)!: prune the dead `ReportColumnSchema`/`ReportGroupingSchema` exports + the unread report chart `groupBy` (#3463, #1878/#1890)

Deep-cleanup close-out of the report-chart disposition (follow-up to #3441).
After the ADR-0021 single-form cutover a dataset-bound report expresses its
columns/grouping as dataset **measure/dimension name arrays** — `values`,
`rows` and `columns` are `z.array(z.string())`, not object literals — so
`ReportColumnSchema` / `ReportGroupingSchema` were referenced by **no schema
body**. They survived only as public type exports and were marked
`@deprecated` in #3441; this removes them.

- Deleted `ReportColumnSchema` / `ReportGroupingSchema` and their type
  exports `ReportColumn` / `ReportGrouping` / `ReportColumnInput` /
  `ReportGroupingInput` from `@objectstack/spec/ui`. The manifest ratchet
  keys `ui/ReportColumn` / `ui/ReportGrouping` are dropped in the same PR.
- Deleted `ReportChart.groupBy` — the `[EXPERIMENTAL — not enforced]`
  series-split field flagged in #3441. The dataset-bound `DatasetReportRenderer`
  plots a single `xAxis`×`yAxis` series and never read it; only the retired
  legacy `ReportViewer` fallback ever consumed a top-level `groupBy`.
  `ReportChartSchema` is non-strict, so any residual `chart.groupBy` in stored
  metadata is silently stripped on parse — no tombstone needed.
- Regenerated `content/docs/references/ui/report.mdx` and the spec API-surface
  snapshot.

**Migration**: nothing an author writes changes.
- No first-party or example report authored `ReportColumn` / `ReportGrouping`
  objects or `chart.groupBy` — a dataset-bound report already expresses
  columns as `values` (measure names) and grouping as `rows` / `columns`
  (dimension names).
- TypeScript consumers importing `ReportColumn` / `ReportGrouping` /
  `ReportColumnInput` / `ReportGroupingInput` (or the `*Schema` values) from
  `@objectstack/spec/ui` have no replacement type — model report columns as
  the dataset's measure names and grouping as its dimension names. objectui's
  `SpecReportColumn*` / `SpecReportGrouping*` re-exports are removed in the
  companion objectui change.
