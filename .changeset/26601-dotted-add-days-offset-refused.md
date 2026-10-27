---
'@objectstack/spec': minor
---

fix(spec)!: the filter save and validate doors refuse an `addDays` offset whose `{ $field }` is a dotted path, in the words SQL push-down already refuses it with on every read

An `addDays` offset reads its days from a column of the same record: `{ $field: 'due_on', addDays: { $field: 'grace_days' } }`, or `{ $now: true, addDays: { $field: 'review_sla_days' } }`. A dotted offset such as `addDays: { $field: 'contract_type.review_sla_days' }` passed `FieldReferenceSchema`, `NowAnchorSchema`, `FilterConditionSchema`, the dataset `filter` and measure `filter`, and `os validate`, and then failed every SQL read with `INVALID_FILTER` / 400. The one executor that walks the path, the memory evaluator, reads a lookup's id there on a stored row and counts the offset as zero days. Now every authoring door refuses it, naming the path: `the addDays offset "contract_type.review_sla_days" is a dotted path, and SQL push-down compiles same-table column references only (no relation traversal, no alias-qualified columns).`

This retires the earlier reading that the dotted offset validates and is answered in memory (the #14104 ruling-record correction 5550346132, and the spec pin that accepted `addDays: { $field: 'duty.grace_days' }`). Ruling A on #25808 bounds the offset to a same-record column.

Clause-②: no (narrowing) — the save and validate doors refuse a dotted `addDays` `$field` that every SQL read already refused. Nothing is widened.

Metadata-protocol: narrowed (a filter, a dataset filter or a dataset measure filter may no longer carry an `addDays` offset whose `$field` is a dotted path)

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed. The dotted offset never compiled on SQL push-down and, on a stored row, read as zero days in memory, so there is no mechanical rewrite that keeps what the author meant: the related value has to be copied onto a numeric column of the row, which is an application change the author makes. -->

**BREAKING** accept-set narrowing on the `addDays` offset (`@objectstack/spec`).

- **Before.** `FieldReferenceSchema`, `NowAnchorSchema`, the ordering slots of `FieldOperatorsSchema`, `FilterConditionSchema` (data filters, dataset `filter`, dataset measure `filter`) and `os validate` accepted `addDays: { $field: 'a.b' }`. SQL reads answered `INVALID_FILTER` / 400; a dataset measure filter answered it with the reason withheld.
- **Now.** Each of those doors refuses it. `parseFilterAST` and the engine's filter doors (`where`, `aggregations[i].filter`, `having`) refuse it with `INVALID_FILTER` / 400 and the path named, so a dataset measure filter that never met the save door now gets the reason too.
- **Unchanged.** A same-record offset column, a literal offset, and the reference's own `$field` (a dotted base reference keeps its asymmetry: resolved in memory, refused by SQL push-down).
- **Who sees it.** An author who read the offset through a relation. Every SQL deployment already refused that filter on read.

**The remedy.** Copy the related value onto a numeric column of the record (on create and whenever the relation changes) and name that column: `addDays: { $field: 'review_sla_days' }`.
