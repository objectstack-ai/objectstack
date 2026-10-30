---
'@object-ui/core': patch
'@object-ui/plugin-charts': patch
'@object-ui/plugin-dashboard': patch
---

Clause-②: yes (widening: @object-ui/core gains the public export formatMonthBucketLabel; no accept set moves)
Metadata-protocol: none

Dashboard numbers and chart labels stay readable on a phone:

- **KPI value.** A dataset-bound KPI tile's value now shrinks to fit its tile, the way the plain metric tiles already did, instead of being cut with an ellipsis (`$1,090,00...` on a phone). Past the smallest size it keeps the ellipsis and shows the full figure as a tooltip. A short value looks as before.
- **Month axis.** A chart over a month-bucketed date dimension labels its axis `Oct 2025` in the reader's locale, not the raw bucket key `2025-10`. The key itself is unchanged in the data, so drill-through and ordering are unaffected. `@object-ui/core` adds `formatMonthBucketLabel(value, locale)`, which answers that label for a `YYYY-MM` key and `undefined` for anything else.
- **Legend swatches.** A bar or area chart's legend draws a colour swatch for every series; it drew none, because those marks fill from a gradient. A comparison (`compareTo`) series' swatch is drawn hollow, so it reads apart from the solid swatch of the series it overlays in the same colour.
- **Horizontal bar labels.** A horizontal bar chart's category labels are drawn in full on a phone, wrapped to at most two lines inside the axis, instead of cut to eight characters (`In Progr…`). A label still too long ends in an ellipsis and shows the full text as a tooltip.
