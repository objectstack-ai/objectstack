---
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

feat(plugin-report): the report chart honours `chart.showEmptyGroups`, and the report builder offers it as a switch

Clause-②: yes (widening)
Metadata-protocol: added

- The dataset report chart adds the `xAxis` field's declared options that the answer left out when `chart.showEmptyGroups` is on: in their declared place, with the option's label and colour, valued `0` for a count or sum and left empty for avg/min/max. With a `seriesBy` split an added option reads the empty value in every series. Whether an option is missing is judged by the stored value the answer's `drillRawRows` carries, so a label the server translated differently is never drawn as a second, zero-valued group. Nothing is added for a field with no declared options, when the report's `order` reaches the chart's query, or on an answer with no rows. A bar on an added option opens no record list.
- The report builder's chart settings gain a "Show groups with no records" switch on every chart type the renderer draws as a series (bar, line and donut among the builder's choices, and a stored funnel, pie or other series type). It writes `chart.showEmptyGroups: true`; off removes the key; a single-value or table chart drops it.
- `@object-ui/i18n`: `report.builder.chart.showEmptyGroups` in all 11 locales.
- `@object-ui/plugin-report` now lists `@objectstack/spec` under `dependencies` (it was a dev dependency): the chart reads the analytics executor's empty-group values from `@objectstack/spec/data` at runtime.
