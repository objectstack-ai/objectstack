---
'@objectstack/skills': patch
---

docs(skills): the skills teach the third `fixed`-currency refusal, a derived measure's own `currency` against its operands' one `fixed` code

Clause-②: no
Metadata-protocol: none

- `objectstack-data` `rules/field-types.md` (Currency resolution) and `objectstack-ui` `rules/dashboards.md` (the dataset currency comment) taught two `fixed` refusals and missed the third: a derived `sum` or `difference` whose monetary operands all resolve to one `fixed` code refuses another `currency` at dataset compile, with `DATASET_INVALID` / 400. Both files now teach it beside the other two, with the shipped prescription: delete the measure's `currency` (the column takes the operands' code), or restate that code.
- Paid for inside each file: `field-types.md` drops the `currency_code` naming convention its own example already shows; `dashboards.md` drops the retired `categoryGranularity` parenthetical, which the parse refusal and the Dataset-Bound Widgets paragraph already carry. Neither ratchet row moves.
- No schema, key or behaviour changes.
