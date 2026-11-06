---
'@objectstack/spec': patch
---

docs(spec): a currency amount's decimal places are named as its currency's CLDR fraction digits, not its ISO 4217 minor unit

Clause-②: no
Metadata-protocol: none

The currency `scale` refusal, the inline grid column's currency `scale` refusal, the `currencyConfig` decimal-places prescription, the `precision` and `scale` describes and the ADR-0087 upgrade-guide entries said "the currency's ISO 4217 minor unit". The platform's digit source is CLDR's fraction digits: `CURRENCY_FRACTION_DIGITS` is a CLDR `currencyData` snapshot, and every display face asks `Intl`, which reads the same data. For sixteen codes the two differ and CLDR's count applies: IQD has 0 (ISO 4217: 3), and AFN, ALL, COP, HUF, IDR, IRR, KPW, LAK, LBP, MGA, MMK, PKR, SOS, SYP and YER have 0 (ISO 4217: 2).

Words only. Nothing is newly accepted or refused, and the remedy is unchanged: delete `scale` on a `currency` field or column. The refusal now reads "the currency's CLDR fraction digits (2 for USD, 0 for JPY, 3 for KWD) decide how the amount displays". A check that matches the old text "ISO 4217 minor unit" in the message no longer matches.
