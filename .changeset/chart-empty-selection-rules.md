---
'@objectstack/lint': minor
---

Two new widget-binding rule ids for a chart widget with an empty selection

`validateWidgetBindings` reported nothing about two dataset-bound chart shapes that the
`@object-ui` revision this repo pins (`.objectui-sha`) visibly degrades. Both are now
warnings, suppressible per widget with `suppressWarnings: ['<rule-id>']`:

- `chart-measures-missing` — a chart-family widget selects no measures (`values` empty or
  absent). `DatasetWidget.tsx:683` returns the authoring placeholder "Pick measures
  (values) for this dataset widget." before any query runs, above every family branch, so
  no chart is drawn at all.
- `chart-dimensions-missing` — a chart-family widget selects at least one measure but no
  dimensions. `DatasetWidget.tsx:423` reads
  `const isMetric = METRIC_TYPES.has(widgetType) || dimensions.length === 0;`, so the
  widget renders as a single KPI number and the declared chart family is silently ignored.
  The hint steers the author to a dimension, or to the `metric`/`kpi` family that matches
  what actually renders.

Warning tier rather than error for both: an empty selection is a work-in-progress state a
build must tolerate, and erroring would gate the `sys_metadata` publish path on a
half-authored widget. Neither shape is folded into `chart-config-missing` — neither is
caused by, nor repairable with, `chartConfig`, which carries presentation only.

"Chart family" is derived, not hand-listed: every declared `ChartTypeSchema` option that
the pinned renderer routes to its chart branch — the taxonomy minus the renderer's own
`METRIC_TYPES` (`metric`, `kpi`, `gauge`, `solid-gauge`, `bullet`) and its `table`/`pivot`
tabular test. A `metric` tile with no dimensions, such as the shipped `system_overview`
board's own KPI tiles, is therefore not a finding.
