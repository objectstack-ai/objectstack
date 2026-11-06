---
'@object-ui/fields': patch
---

docs(fields): `currencyFractionDigits` is documented as CLDR's fraction digits, not ISO 4217's

Clause-②: no
Metadata-protocol: none

The published declaration of `currencyFractionDigits` said it returns "the number of fraction digits ISO 4217 gives" a currency. It asks `Intl`, which reads CLDR's `currencyData`, so it now says CLDR. For sixteen codes the two differ (IQD 0 where ISO 4217 says 3, and fifteen codes 0 where ISO 4217 says 2), and the function has always answered CLDR's count. Words only: no return value changes.
