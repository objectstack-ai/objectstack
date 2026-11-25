---
'@object-ui/plugin-report': patch
---

fix(plugin-report): a report chart hands its chart the measure's format, so the value axis reads `33.3%` and `¥` beside the table

Clause-②: yes
Metadata-protocol: none

A report chart's series now carry the plotted measure's `format`, `percentScale` and single currency as the chart's internal `series[].measureFormat`. The chart's value axis then prints a measure stored in percentage points (`percentScale: 'whole'`) as percents and a currency amount with its symbol, as the table beside it does. A measure with a per-row currency (`currencyField`) hands no currency, so its axis keeps plain numbers. The fraction-scale percent pattern still travels on the value-axis `format` key as before.

Nothing to migrate: no metadata key changes.
