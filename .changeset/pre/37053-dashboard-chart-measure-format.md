---
'@object-ui/plugin-dashboard': patch
---

fix(plugin-dashboard): a dashboard chart widget's value axis prints its measure's percent and currency units

Clause-②: yes
Metadata-protocol: none

A dataset chart widget's series now carry the format facts of the measure they plot (`format`, `percentScale` and its single currency) as the chart's internal `series[].measureFormat`. The value axis then prints a percent measure as percents (`0.0%` … `36.0%` for a rate in percentage points, which drew `0` … `36` before) and a currency amount with its symbol, as the widget's table prints them. A measure with a per-row currency (`currencyField`) keeps plain numbers. A dimensionless chart that plots several measures carries a format only when they all share it.

Nothing to migrate: no metadata key changes.
