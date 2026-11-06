---
'@object-ui/plugin-form': patch
---

fix(plugin-form): the warning for a `scale` on a currency inline grid column names the currency's CLDR fraction digits

Clause-②: no
Metadata-protocol: none

The console warning for an inline grid column that renders as `currency` and carries `scale` repeats the spec's refusal, which now says "the currency's CLDR fraction digits (2 for USD, 0 for JPY, 3 for KWD) decide how the cell displays the amount" instead of naming the ISO 4217 minor unit. Words only: the same columns are reported, and the column still renders at its currency's digits.
