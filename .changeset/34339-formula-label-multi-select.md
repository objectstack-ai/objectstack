---
'@objectstack/formula': minor
---

fix(formula): `label()` over a multi-select reads each selected option's label, joined with `, `

Clause-②: no
Metadata-protocol: semantic

A formula `label(record.<field>)` over a `multiple: true` select used to fault on every non-empty selection, so the formula field read null in every view (the engine logged "renders ONE option value … holds a list of values"), while `os validate` and `os lint --strict` passed it.

It now reads the label of each selected value in the reader's language, in the order the record stores the values, joined with `, `: a record holding `['no_sales_price', 'no_customer']` reads `无销售价, 无客户` to a `zh-CN` reader and `No sales price, No customer` to an `en-US` one. A one-value selection reads that one label. An empty selection or an empty field reads `''`, as before. A listed value no option declares reads as stored, as a single value does.

This is the rule a mail template's `option` hole already prints a multi-select by; both now go through one shared helper, so the two cannot drift. A single select reads exactly as before. Nothing to migrate: a formula that read null now reads text.
