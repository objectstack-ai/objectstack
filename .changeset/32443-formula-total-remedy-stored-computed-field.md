---
'@objectstack/spec': patch
'@objectstack/lint': patch
'@objectstack/service-analytics': patch
---

fix(spec,lint): the refusal of a total over a formula field names a stored computed field, not a hook

Clause-②: no
Metadata-protocol: none

A `sum`, `avg`, `min` or `max` over a `formula` field stays refused, at authoring (`os validate` / `os build` / `os lint`) and at the dataset compile (`400 DATASET_INVALID`): a formula is computed on read and has no column. What changes is the way out the refusal prints. `VIRTUAL_FIELD_AGGREGATE_REMEDY` (`@objectstack/spec/data`) now reads:

> The field is computed on read and stores no value: make it a number field with the same `expression` (computed and stored on every write) and aggregate that. Counting records is a different question.

- **Before.** It said to store the value as a number field "kept by a hook". A hook is code, which an author on a hosted tier may not be able to add, so the refusal named no way out that every author can take.
- **Now.** It names a mechanism that already exists and needs no code: a `number` field (not a `formula`) carrying the same `expression` is a stored computed field. The engine computes it from the row each write stores, on an insert, a batch insert and an update by id, and stores the result, so a value the client sends for it does not stand and `sum` / `avg` / `min` / `max` aggregate it like any number. For a leave app: `` days: Field.number({ readonly: true, expression: F`daysBetween(record.start_date, record.end_date) + 1` }) ``, then a dataset measure `{ aggregate: 'sum', field: 'days' }`.
- **No aggregate name for the count.** The sentence no longer names `count` / `count_distinct`. A list-view column summary cannot take `count_distinct` (it spells that count `count_unique`), and the same sentence is printed on that surface too.
- **Where it is printed.** The dataset compile leg (`service-analytics`) and the lint rules `measure-aggregate-field-type-refused`, `list-view-summary-field-type-refused`, `list-view-group-order-unorderable` and `grid-aggregation-field-type-refused` print it as their fix line, and each rule's `os explain` entry holds it verbatim. `os explain dimension-virtual-field-refused` points a group key over a formula at the same mechanism: a field of the formula's `returnType` carrying the same `expression`.
- **Known limit when converting an existing formula.** Rows stored before the field became a stored computed field hold `NULL` in its column until each is written again, so a total over them reads low until then. The boot names such fields, and `os migrate stored-expressions --apply` fills them (`--changed` also recomputes values after an expression is edited).

Nothing an author writes is accepted or refused differently: no schema key, value or rule verdict moves.
