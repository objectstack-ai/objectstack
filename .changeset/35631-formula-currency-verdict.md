---
'@object-ui/app-shell': patch
'@objectstack/spec': patch
'@objectstack/formula': patch
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

`@objectstack/formula`'s `inferFormulaReturn` now answers `{}` (unproven) where it used to answer `{ returnType: 'number' }` for a numeric expression that reads a money-typed operand the proof cannot follow: a `currency` field, a formula declared `currency`, or a `summary` other than a `count`. FROM `inferFormulaReturn('record.rollup * 0.9', fields)` → `{ returnType: 'number' }` TO → `{}`; likewise `100 / record.amount`, `record.amount % 3`, `record.amount * 1.0 + record.fee_eur * 1.0` (two currencies), `double(record.amount) * double(record.tax)`, and an amount whose `currencyConfig` does not parse. So a `number` answer now always means "proved not money", and only that answer withdraws a declared `currency`. An expression that reads no such operand (a `count` roll-up included) is answered as before, and a ratio of two amounts in one currency is unchanged. A caller that read the old `number` for these shapes should read the expression's CEL type (`inferExpressionType`) instead. In Studio, a new formula over such an amount is still stamped `number` from that CEL type.

The stamp still runs only after the author edits the expression; selecting a field writes nothing. The `returnType` description in `@objectstack/spec` now says the same: `currency` is stamped when the expression provably computes money and withdrawn for `number` when an edit leaves it a plain number.
