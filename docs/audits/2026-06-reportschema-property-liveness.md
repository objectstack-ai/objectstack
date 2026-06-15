# Audit: ReportSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/report.zod.ts` (ADR-0021 single-form). **Live path**: `objectui` `ReportRenderer`→`DatasetReportRenderer` (dataset-bound). Pre-9.0 object/columns-query renderers retired; old JSON limps through the lossy `specReportToPresentation` bridge.

## LIVE & well-wired (dataset shape — the canonical path)
`name`, `label`, `description`, `type` (summary/tabular/matrix/joined), `dataset`, `rows`, `columns` (matrix-across only, matches spec), `values`, `runtimeFilter` (`?? filter`, ANDed via `mergeFilters`), `drilldown` (default-on; cells clickable), `blocks` (joined, per-block dataset/rows/columns/values/runtimeFilter). Evidence: `DatasetReportRenderer.tsx:486-575`, `:493-543`. Wired types: tabular/summary/matrix (true cross-tab + server totals + drill)/joined.

## 🔴 DEAD on the live path — aspirational
- **`chart`** (top-level and per-block) — in the spec + `report.form.ts:62` (editable in Studio) but **no renderer reads `report.chart`**. The dataset renderer ignores it entirely; legacy `ReportViewer` only handles a different `section.chart`/`xAxisField` shape via the bridge, which never populates from spec `report.chart`. **Editing chart config produces no output.**
- **`aria`**, **`performance`** — `report.form.ts:71-72` only; no renderer.

## 🔴 Obsolete sub-schemas (type-only re-exports, fully superseded by ADR-0021)
- `ReportColumnSchema` (`field/label/aggregate/responsive`) — replaced by plain `string[]` `values`; per-column aggregate/label now live in the **dataset** definition.
- `ReportGroupingSchema` (`field/sortOrder/dateGranularity`) — replaced by `string[]` `rows`; sort/granularity now in the **dataset**.
- `ReportChartSchema` (`xAxis/yAxis/groupBy`) — **naming drift**: the only chart code (`ReportViewer.tsx:329`) reads legacy `xAxisField/yAxisFields`, never the spec's `xAxis/yAxis` → spec chart field names are dead.

## Studio gap (PARTIAL)
`ReportPreview.tsx:34` branches on top-level `draft.dataset` only — a **`joined`** report (legitimately has no top-level `dataset`; data on `blocks`) falls to the "bind a dataset" empty state instead of previewing, though the runtime renders it. Joined previews are effectively unwired in Studio.

## Recommendation
Remove `chart`/`aria`/`performance` from ReportSchema (or wire `chart` for dataset reports). Delete the obsolete `ReportColumn/ReportGrouping/ReportChart` re-exports. Fix `ReportPreview` to preview joined reports (branch on `dataset || blocks?.length`).
