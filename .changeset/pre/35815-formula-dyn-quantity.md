---
'@objectstack/formula': patch
---

fix(formula): `inferFormulaReturn` answers `number` for a proven plain number whose CEL type is `dyn`, so Studio withdraws a stale `currency` on a field-over-field quantity edit

Clause-②: no
Metadata-protocol: none

A field read is `dyn` to cel-js, so an operator over two field reads types `dyn`. `inferFormulaReturn` answered such an expression `{}` (unproven) even when its unit proof had read every operand as a declared number. Studio's formula inspector withdraws a declared `currency` only on a `number` answer, so an author who edited `record.amount * 0.1` into `record.quantity * record.hours` kept `returnType: 'currency'` and its `currencyConfig`, and the value was still drawn as money.

FROM `inferFormulaReturn('record.quantity * record.hours', fields)` → `{}` TO → `{ returnType: 'number' }`, over a field map that declares both as plain numeric fields. The same holds for every expression the unit proof proves a plain number whose CEL type is `dyn`: `record.quantity / record.hours`, `record.quantity + record.hours`, `quantity * hours`, a ternary or `max` over two quantities, and a ratio of two amounts in one currency (`record.amount / record.tax`). Money over two field reads (`record.amount * record.quantity`) still answers `currency`. What the proof cannot follow still answers `{}`: a ratio across two currencies, anything divided by an amount, an amount times an amount, an operand whose unit cannot be read.

A quantity read through a relationship (`record.account.employee_count * 2`) still answers `{}`: the related object's fields are not an input to `inferFormulaReturn`, so the leaf's unit cannot be read, and a declared `currency` is kept on that edit. The function's header now records this as an accepted limit.

Nothing to migrate. A caller that read `{}` for these shapes as "keep the declaration" now gets `number`, which means proved not money.
