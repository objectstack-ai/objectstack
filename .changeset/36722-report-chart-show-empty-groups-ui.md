---
'@object-ui/plugin-report': patch
'@object-ui/i18n': patch
---

feat(plugin-report): the report chart honours `chart.showEmptyGroups`, and the report builder offers it as a switch

Clause-②: yes (widening)
Metadata-protocol: added

- The dataset report chart adds the `xAxis` field's declared options that the answer left out when `chart.showEmptyGroups` is on: in their declared place, with the option's label and colour, valued `0` for a count or sum and left empty for avg/min/max. With a `seriesBy` split an added option reads the empty value in every series. Nothing is added for a field with no declared options, or when the report's `order` reaches the chart's query. A bar on an added option opens no record list.
- The report builder's chart settings gain a "Show groups with no records" switch on bar, line and donut charts. It writes `chart.showEmptyGroups: true`; off removes the key; a number or a table drops it.
- `@object-ui/i18n`: `report.builder.chart.showEmptyGroups` in all 11 locales.
