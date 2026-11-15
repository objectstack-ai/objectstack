---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a long text formula or text roll-up on the record page wraps instead of being cut to one line

Clause-②: no — a value that was cut now shows in full; no surface added
Metadata-protocol: none

The record page's field grid drew `formula` and `summary` values with the formula cell, whose text face is the grid's one-line cell (`truncate`, an ellipsis, the whole value only in a hover `title`). A long text formula, such as an explanation sentence, read as its first few words, and touch and screen-reader users never reached the rest.

These rows now read through the field widget's own read display, the face the record form draws: `FormulaField` for a formula and `SummaryField` for a roll-up. Their text face wraps. Number, money, date and boolean results read the same words as before, because each widget reads the value by the rule the cell reads it by. List grid rows and the highlights strip keep the one-line cell. A host that registered its own `formula` or `summary` cell keeps it on the record page.
