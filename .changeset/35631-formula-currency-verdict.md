---
'@object-ui/app-shell': patch
'@objectstack/spec': patch
'@objectstack/formula': patch
---

fix(app-shell): Studio's formula inspector asks whether the formula still computes money before it keeps a `currency` result type

Clause-②: yes (widening)
Metadata-protocol: none

When an author edited a formula field in Studio, the inspector re-stamped `returnType` from the expression's inferred CEL type, and kept a declared `currency` under every `number` or unproven verdict, because that type never says "money". So a formula edited from an amount (`record.amount * 0.1`) into a count (`record.est_hours * 2`) kept `returnType: 'currency'` and its `currencyConfig`, and its value was still shown as an amount.

The stamp now also asks `@objectstack/formula`'s `inferFormulaReturn`, over the object's declared fields, whether the edited expression computes money:

- Provably money: `returnType` is stamped `currency`, with the currency the source amounts are in as the formula's `currencyConfig` (absent for the tenant default currency). This holds for a formula that was `number` too.
- An edit it answers `number` for withdraws a declared `currency`: `returnType` becomes `number` and the `currencyConfig` is removed.
- An unproven verdict (a field-over-field quotient, two currencies meeting) keeps a declared `currency`, as before, and so does an engine that does not offer `inferFormulaReturn`.
- A declared `percent` is unchanged: it survives a `number`, unproven or money verdict, and is never re-stamped `currency`. A verdict that proves `text`, `boolean` or `date` still stamps, and now also removes a stale `currencyConfig`.

`@objectstack/formula`'s `inferFormulaReturn` now answers `{}` (unproven) where it used to answer `{ returnType: 'number' }` on the numeric path, unless the unit proof succeeds or every read of the record (`record.x`, `record['x']`, `record.?x`, `record[?'x']`, or a bare `x`) is one segment naming a declared field whose unit can be read and is not money. FROM `inferFormulaReturn('record.rollup * 0.9', fields)` → `{ returnType: 'number' }` TO → `{}`. The same holds for `100 / record.amount`, `record.amount % 3`, `record.amount * 1.0 + record.fee_eur * 1.0` (two currencies), `double(record.amount) * double(record.tax)`, an amount whose `currencyConfig` does not parse, a hop through a reference (`record.account.balance * 0.9`), a formula operand that declares no `returnType` (`record.subtotal * 0.2`), the indexed and optional spellings of an amount (`record['amount'] * 0.1`), and a name the field map does not declare (`record.unknown_field * 2`). A call with no field map therefore answers `{}` for any numeric expression that reads the record (`inferFormulaReturn('record.amount * 0.1')` was `number`). So a `number` answer means "proved not money", and only that answer withdraws a declared `currency`.

What still answers `number` is an expression over declared fields of readable non-money units: number, percent and other plain fields, a formula declaring a non-`currency` `returnType`, and a `count` roll-up whose `summaryOperations` is passed. A bare ratio of two amounts in one currency (`record.amount / record.tax`) types `dyn` and answers `{}`, as before. A caller that read the old `number` for these shapes should read the expression's CEL type (`inferExpressionType`) instead. In Studio, a new formula over such an amount is still stamped `number` from that CEL type.

Widened: the published `FormulaSourceField` type gains one optional member, `summaryOperations` (a `summary` field's roll-up, as declared). A `count` roll-up is read as a plain number only when it is passed. A roll-up passed without `summaryOperations`, a `count` included, is read as possibly money, so an expression over it answers `{}`.

The stamp still runs only after the author edits the expression; selecting a field writes nothing. The `returnType` description in `@objectstack/spec` now says the same: `currency` is stamped when the expression provably computes money and withdrawn for `number` when an edit leaves it a plain number, and a declared `percent` is kept under a money verdict.
