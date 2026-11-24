---
'@objectstack/skills': patch
---

docs(skills): the data skill says a lookup pick copies a currency amount only between fields in the same currency

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data` (`rules/field-types.md`) described `lookupAutofill` as an unconditional copy. It now states the rule the platform applies to a declared pair and to the line-item grid's same-named `autofill` copy: a `currency` amount is copied only between fields in the same currency (a `fixed` code or a per-record one); otherwise the target is left as it was and the form says why. Nothing is converted, so a line in another currency takes its price by hand. The sentence is paid for in the same file by trimming type-table cells that only restated the type name. No behaviour changes.
