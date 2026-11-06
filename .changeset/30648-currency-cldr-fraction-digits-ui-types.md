---
'@object-ui/types': patch
---

fix(types): the form face's currency `scale` refusal names the currency's CLDR fraction digits, the spec's wording

Clause-②: no
Metadata-protocol: none

`CURRENCY_FIELD_SCALE_REFUSAL` is held equal to `@objectstack/spec`'s currency `scale` refusal, which now says "the currency's CLDR fraction digits (2 for USD, 0 for JPY, 3 for KWD) decide how the amount displays" instead of naming the ISO 4217 minor unit. Words only: the same entries are refused at the same path.
