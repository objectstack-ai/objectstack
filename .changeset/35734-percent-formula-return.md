---
'@objectstack/lint': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
---

fix: a `percent` or `currency` formula totals and chips as its return type; the lint prescription names all six return types

Clause-②: no
Metadata-protocol: none

A `formula` field whose `returnType` is `percent` drew percentages in its list cells while the grid footer summed it as a plain number (`Sum: 0.75` under cells reading `25%` and `50%`), and the record header strip drew it without the figure typography a `percent` field's chip has. The footer and the strip now read a formula's declared `returnType` before they pick an arm, for the two return types the spec reads as a field type: a `percent` formula totals as a percentage (`Sum: 75%`) at its declared `scale` and `max`, as a `percent` field does, and a `currency` formula totals as money in the currency its `currencyConfig` declares, as a `currency` field does. Both are KPI chips on the header strip. A formula of any other return type totals and chips as before.

`os explain dimension-virtual-field-refused` told the author to make a stored copy "of the formula's `returnType` (`number`, `text`, `boolean`, `date` or `currency`)", which named no type for a `percent` formula. It now lists all six, and a test holds the list to the spec's own `returnType` enum.
