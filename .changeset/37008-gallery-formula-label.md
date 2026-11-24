---
'@object-ui/fields': patch
'@object-ui/plugin-list': patch
---

fix(plugin-list): a gallery card labels and formats a formula or summary column whose result is a number, an amount or a percentage

Clause-②: no
Metadata-protocol: none

A gallery card, which is also how a phone draws a related list's rows, now gives a `formula` or `summary` column the same treatment as a stored number when its result is a number, an amount or a percentage: the field's label before the value, and the format the related-list table gives the same field. A `returnType: 'currency'` formula reads `Total 12,000.00` on the card, as it does in the table. Before, it read a bare `12,000` beside `Unit price 6,000.00`, so the reader could not tell what the figure was. A summary declaring its `currencyConfig` reads as money in the same way. A formula whose result is text stays unlabeled, as a text field does.

The card's field builder now hands the cell `returnType` and `currencyConfig`, the two declarations the related-list table's builder already hands it. A plain `currency` field with a fixed `currencyConfig` therefore also shows its own currency on a card instead of the tenant default.

`@object-ui/fields` exports `resolveFormulaValueType(field, value)`, the rule the formula cell uses to choose how it draws a result. The formula cell now calls it, and so does the card's label decision, so the two cannot disagree.
