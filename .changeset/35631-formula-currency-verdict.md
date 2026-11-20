---
'@object-ui/app-shell': patch
'@objectstack/spec': patch
---

fix(app-shell): Studio's formula inspector asks whether the formula still computes money before it keeps a `currency` result type

Clause-②: no
Metadata-protocol: none

When an author edited a formula field in Studio, the inspector re-stamped `returnType` from the expression's inferred CEL type, and kept a declared `currency` under every `number` or unproven verdict, because that type never says "money". So a formula edited from an amount (`record.amount * 0.1`) into a count (`record.est_hours * 2`) kept `returnType: 'currency'` and its `currencyConfig`, and its value was still shown as an amount.

The stamp now also asks `@objectstack/formula`'s `inferFormulaReturn`, over the object's declared fields, whether the edited expression computes money:

- Provably money: `returnType` is stamped `currency`, with the currency the source amounts are in as the formula's `currencyConfig` (absent for the tenant default currency). This holds for a formula that was `number` too.
- An edit it answers `number` for withdraws a declared `currency`: `returnType` becomes `number` and the `currencyConfig` is removed.
- An unproven verdict (a field-over-field quotient, two currencies meeting) keeps a declared `currency`, as before, and so does an engine that does not offer `inferFormulaReturn`.
- A declared `percent` is unchanged: it survives a `number` or unproven verdict. A verdict that proves `text`, `boolean` or `date` still stamps, and now also removes a stale `currencyConfig`.

The stamp still runs only after the author edits the expression; selecting a field writes nothing. The `returnType` description in `@objectstack/spec` now says the same: `currency` is stamped when the expression provably computes money and withdrawn for `number` when an edit leaves it a plain number.
