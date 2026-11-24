---
'@object-ui/plugin-report': patch
'@object-ui/plugin-charts': patch
---

fix(plugin-report): a report chart's value axis reads a percent measure in percent, and two value-axis ticks never share a label

Clause-②: no
Metadata-protocol: none

- **A report chart over a percent measure labels its value axis in percent.** A dataset measure with a percent `format` (`'0.0%'`) charted in a report drew its value axis in raw fractions (`0`, `0.1`, `0.2`, `0.3`) while the table beside it printed `33.3%`. The report now hands the measure's pattern to the chart as its value-axis `format`, so the axis reads `0.0%` … `34.0%`. This applies to a percent pattern on a measure stored as a 0–1 fraction, which is the table's reading of such a pattern. A measure already in percentage points (`percentScale: 'whole'`), a currency measure, and a plain numeral pattern keep the chart's default axis, because the chart's axis `format` cannot say what the table prints for them.
- **Two ticks on a value axis never share a label.** With no axis `format`, the value axis printed at most one fraction digit, so the ticks of a small domain collapsed: a 0–⅓ axis read `0, 0.1, 0.2, 0.3, 0.3`. Each value axis now prints its ticks to the decimal place its tick step needs (`0, 0.085, 0.17, 0.255, 0.34`), in compact notation as before. A declared axis `format` keeps its own places unless they are too coarse for the step, in which case the ticks gain the places the step needs (`'0%'` over a 0.85-point step reads `0.85%`, not two `3%` ticks). Data labels follow their value axis, as they already did.

Nothing to migrate: no metadata key changes and no export changes.
