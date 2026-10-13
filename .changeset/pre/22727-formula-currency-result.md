---
"@objectstack/spec": minor
"@objectstack/formula": minor
"@objectstack/platform-objects": patch
---

A formula field can declare a currency result: `returnType: 'currency'`, with its currency in its own `currencyConfig`

Clause-②: yes (widening)

- **What is new in `@objectstack/spec`.** `FieldSchema.returnType` accepts `'currency'` beside `'number'`, `'text'`, `'boolean'` and `'date'`. A `currency` result is an amount of money. Its value is a bare number, as a currency field's is. Its currency is the formula field's own `currencyConfig`, the same `CurrencyConfigSchema` a currency field carries, with the same defaults and the same refusals: no `currencyConfig` means dynamic mode (the tenant default currency), and `{ currencyMode: 'fixed', defaultCurrency: 'USD' }` fixes it. Nothing is read at display time from the fields the expression references: the currency is a declaration on the formula.
- **Readers.** The filter doors judge a formula returning `currency` as the currency field it reads like: a text operator on it is refused (`INVALID_FILTER`), and the number door judges its comparands. A formula is still not title-eligible unless it returns `text`, and is still refused for `sum` / `avg` / `min` / `max` (it has no stored column).
- **Designer forms.** The field designer and the object designer's field grid both offer Currency as a return type. The field designer shows its Currency Config row for a formula whose return type is Currency, as it does for a currency field.
- **What is new in `@objectstack/formula`.** `inferFormulaReturn(expression, fields)` returns the declaration authoring stamps onto a formula field, judged over the host object's declared field map: `{ returnType: 'currency' }` when the expression is provably an amount of money, plus `currencyConfig: { currencyMode: 'fixed', defaultCurrency }` when its source amounts are in one fixed currency. "Provably money" is unit checking over the expression: amounts in one currency added, subtracted, scaled by a number or a percent, divided by a number, rounded, or picked by `min` / `max` / `coalesce` / a ternary. Two different currencies, an amount multiplied by an amount, or an amount plus a plain quantity are not money. For everything it cannot prove to be money it answers exactly what `inferExpressionType` answers, so a numeric formula stays `number`. Its types `FormulaReturnDeclaration` and `FormulaSourceField` are exported with it. `inferExpressionType` is unchanged.
- **`@objectstack/platform-objects`.** The designer help text for the return type and the currency config rows names the currency result, in all four locales.
- **Nothing to migrate.** Every value accepted before is accepted now. To declare a formula over money as money, declare `returnType: 'currency'` and copy the source currency field's `currencyConfig` onto the formula, or run `inferFormulaReturn` and write what it returns.
