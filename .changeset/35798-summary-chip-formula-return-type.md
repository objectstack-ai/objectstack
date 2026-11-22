---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record header summary chip reads a formula by its declared return type

Clause-②: no
Metadata-protocol: none

A `summaryFields` chip beside a record's title over a `formula` field printed the raw value, because the chip picked its formatting from the field type `formula`: a percent formula read `0.25` where its list cell and highlight chip read `25%`, a currency formula read a bare `1250`, and a date formula read its ISO text. The chip now draws a formula whose `returnType` is `percent`, `currency` or `date` as a field of that type: a percent at the formula's own `scale` and `max`, an amount in its own `currencyConfig` currency (the tenant currency when it declares none), a date as a localized date. A `number`, `text` or `boolean` formula reads as before. The highlights strip and the chip now ask one helper which field type a formula reads as.
