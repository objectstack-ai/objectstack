---
'@objectstack/spec': minor
---

feat(spec)!: the object parse refuses a `homeAmount.rateField` whose number field declares a `scale` below 12, the decimals an exchange rate carries; `CURRENCY_FRACTION_DIGITS` is documented as CLDR fraction digits, not ISO 4217 minor units

Clause-②: no (narrowing) — the object parse (`ObjectSchema`, so `os validate`, `os compile` and the metadata doors that parse an object) refuses an object whose `homeAmount.rateField` names a `number` field declaring `scale` 0 to 11, a declaration it accepted before. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-data/rules/field-types.md` teaches `rateField` as a readonly `number` with no `scale`, which this change still accepts; the floor ships in the refusal text, the FROM → TO below and the upgrade-guide entry.

<!-- adr-0087: registered home-amount-rate-field-scale-floor -->

**BREAKING** accept-set narrowing in the object parse: `fields.AMOUNT.currencyConfig.homeAmount.rateField`.

- **Before.** A rate field declared `Field.number({ readonly: true, scale: 4 })` parsed. The engine stored the rate it used with all twelve decimals anyway (the rate row's own value, never rounded), so the declared `scale` only rounded the rate a reader was shown: `0.1389` for a stored `0.138912345678`, a rate that no longer reproduced the stored home amount.
- **Now.** The parse refuses it at `fields.AMOUNT.currencyConfig.homeAmount.rateField`, naming the field, its `scale` and the floor 12, the rate's scale (ruling 6469382727: twelve digits after the decimal point, total precision 24). A rate field with no `scale` is accepted: on a `number` field an absent `scale` declares no fixed width, so the rate shows every digit it was stored with. `scale: 12` or more is accepted.
- **Unchanged.** What the engine stores and computes, and every stored row.
- **Docs.** `CURRENCY_FRACTION_DIGITS` and the currency page now say the table is CLDR's fraction digits, and list the sixteen codes where they differ from ISO 4217's minor units: IQD (CLDR 0, ISO 3) and AFN, ALL, COP, HUF, IDR, IRR, KPW, LAK, LBP, MGA, MMK, PKR, SOS, SYP, YER (CLDR 0, ISO 2), measured against SIX's ISO 4217 List One of 2024-06-25.

**FROM → TO.** `amount_rate: Field.number({ readonly: true, scale: 4 })` → `amount_rate: Field.number({ readonly: true, scale: 12 })`, or `Field.number({ readonly: true })` with no `scale`.
