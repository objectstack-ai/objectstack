---
'@objectstack/formula': patch
'@objectstack/objectql': patch
---

feat(formula): `@objectstack/formula` publishes the home-amount conversion arithmetic, `toScaledDecimal`, `divideToPlaces`, `formatScaledDecimal`, `documentDateOf` and the `ScaledDecimal` type

Clause-②: yes (widening)
Metadata-protocol: none

The four functions the write-time home projection (ADR-0144 D5) converts a record amount with: exact decimal reading, the one division by the rate rounded half away from zero to the decimals you pass (the home currency's `CURRENCY_FRACTION_DIGITS`, still in `@objectstack/spec`), the canonical decimal spelling, and the calendar day a document date names in the organization's timezone (UTC when unset). They move unchanged out of `@objectstack/objectql`, which now imports them back and still re-exports them from its projection module, so a form can preview "≈ home amount" with the engine's own arithmetic instead of a second copy. Stored home amounts, rates and refusals do not change.
