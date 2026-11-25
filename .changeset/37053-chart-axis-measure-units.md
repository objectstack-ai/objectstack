---
'@object-ui/plugin-charts': patch
---

fix(plugin-charts): a chart's value axis prints its dataset measure's percent and currency units

Clause-②: yes
Metadata-protocol: none

- **A value axis over a dataset measure reads in the measure's units.** The chart renderer's internal series props carry one more producer-filled key, `series[].measureFormat` (the measure's `format`, `currency` and `percentScale`), beside `series[].aggregate`. No author writes it. A value axis whose series all carry the same one prints its ticks, and the data labels that share its format, in that measure's units:
  - a percent pattern prints through `formatMeasure`, the function the table uses, at the column's own `percentScale`. A measure stored in percentage points (`percentScale: 'whole'`) reads `0.0%` … `36.0%`, where the axis printed `0` … `36`;
  - a measure with one ISO currency prints the compact default with that currency's symbol (`CN¥3K` … `CN¥12K`, `¥30万` in Chinese), where the axis printed `3K` … `12K`.
- A declared axis `format` still wins over the measure's units. A measure with a per-row currency (`currencyField`) has no single currency, so its axis keeps plain numbers. Two series on one axis that are formatted differently also keep the default axis.

Nothing to migrate: no metadata key changes, and the widened series type is the renderer's internal one.
