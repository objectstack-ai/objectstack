---
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

feat(report): 「Compare with previous period」 beside a report's period chip — the chart draws the earlier window beside the current one

Clause-②: yes (widening) — one new `@object-ui/i18n` key, `report.dateRange.comparePrevious`, in all 11 locales; no export, spec key, schema or server change
Metadata-protocol: none

- **The switch**: a report that declares `dateRange` now shows 「Compare with previous period」 next to its period chip when its chart can draw a comparison (bar, column, horizontal bar, line, area, or a single number, without a `seriesBy` split). Like the period pick it is the viewer's and is not saved into the report. It is off, and cannot be turned on, while the period is All time or a custom range missing an end.
- **What it asks for**: the chart's dataset query carries the contract's `compareTo: { kind: 'previousPeriod', dimension }`, on the same dimension and window the period chip already sends. The earlier window is the contract's `previousPeriod`: the same number of days, ending the day before the current window starts — the previous calendar period only when the two are equally long (`this_month` in a 31-day month compares with the 31 days before it). On a chart whose x axis is the window's own date dimension, the earlier window's buckets pair with the current ones by position from each window's start. The table beside the chart is not asked for a comparison.
- **What it draws**: a bar or line chart gets one more series, the measure's earlier window, labelled 「<measure> · vs previous period」 and drawn muted by the chart's existing `comparison` styling; a single number shows the previous period's value and the change in percent under it. A click on an earlier-window mark opens no record list, the dashboard's rule for the same series. A comparison the server refuses is shown where the chart was, instead of the chart disappearing.
