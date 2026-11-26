---
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

feat(report): 「Compare with previous period」 beside a report's period chip — the chart draws the earlier window beside the current one

Clause-②: yes (widening) — one new `@object-ui/i18n` key, `report.dateRange.comparePrevious`, in all 11 locales; no export, spec key, schema or server change
Metadata-protocol: none

- **The switch**: a report that declares `dateRange` now shows 「Compare with previous period」 next to its period chip when its chart can draw a comparison: bar, column, horizontal bar, line or area over a category axis, or a single number. It is not offered on a `seriesBy` split, nor on a chart whose x axis is the window's own date dimension, where the earlier window's date buckets would not line up with the current ones. Like the period pick it is the viewer's and is not saved into the report. It is off, and cannot be turned on, while the period is All time or a custom range missing an end.
- **What it asks for**: the chart's dataset query carries the contract's `compareTo: { kind: 'previousPeriod', dimension }`, on the same dimension and window the period chip already sends. The chart is compared with the same-length window just before the current one (the contract's `previousPeriod`). The table beside the chart is not asked for a comparison.
- **What it draws**: a bar or line chart gets one more series, the measure's earlier window, labelled 「<measure> · vs previous period」 and drawn muted by the chart's existing `comparison` styling; a single number shows the previous period's value and the change in percent under it. A click on an earlier-window mark opens no record list, the dashboard's rule for the same series. A comparison the server refuses is shown where the chart was, instead of the chart disappearing.
